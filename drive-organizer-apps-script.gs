/**
 * DRIVE ORGANIZER V3 - Google Apps Script
 * Scan-first, intelligence-driven Google Drive organization
 *
 * Pass system:
 *   Pass 1:  Full Inventory Scan (every file + folder logged)
 *   Pass 2A: Classify FOLDERS as intact units (coherent folders move whole)
 *   Pass 2B: Classify FILES (content-aware; skips files moving with their folder)
 *   Pass 2C: Build Organization Plan (two sections: folder moves, then files)
 *   Pass 3:  Execute Structure Changes (move/rename/create, all logged for undo)
 *   Pass 4:  File Rename (Mode A mechanical + Mode B AI with approval queue)
 *
 * Design principles:
 *   - Folders first: coherent folders move intact, preserving the owner's mental map
 *   - Triage before filing: every file is KEEP / DELETE-candidate / REVIEW first
 *   - Content over guessing: Google-native files are read (first ~300 chars) at
 *     classification time; opaque files get honest, capped confidence
 *   - Graduated confidence: >=85 auto-approved, 60-84 PENDING (opt in), <60 → review
 *   - Everything reversible: every executed move/rename is logged; Undo Last Run
 *     reverses the most recent execution
 *   - Pillar folders are fixed anchors; sub-folders are earned (threshold, default 5)
 *   - Every change is proposed in a dry run, reviewed, then executed
 *
 * TEMPLATE NOTE: PILLAR_ANCHORS, KNOWN_SUBFOLDERS, and DEPTH_RULES ship as a
 * generic example taxonomy. Customize them to the drive you are organizing
 * (your own pillar names, subfolders, and client folder names) before running.
 */

// ============================================================================
// SECTION 1: CONFIGURATION
// ============================================================================

/**
 * Fixed pillar folders - these ALWAYS exist as top-level anchors.
 * They mirror the Life OS pillar structure in Notion.
 * Sub-pillars are also fixed anchors (e.g., 1.1, 1.2, 4.1, 4.2).
 * Sub-folders WITHIN sub-pillars are dynamic (earned by file count).
 */
const PILLAR_ANCHORS = {
  // MIND
  '1.0_MIND': { description: 'Inner clarity and self-direction. Includes: life reflections, vision boards, journaling templates, intention-setting docs, life design notes. Does NOT include: coaching program materials (1.2), any recurring reviews — daily, weekly, monthly, quarterly, annual (1.3), workout or nutrition plans (2.0), personal logistics (3.1), product assets for distribution (4.4).' },
  '1.1_CURRENT_SELF': { description: 'Snapshot of who you are right now, plus educational background. Includes: personality tests, values inventories, belief audits, skills assessments, identity statements, academic and educational materials (university coursework, certifications, completed formal education). Does NOT include: goal-setting or future-vision docs (1.2), routines or systems (1.3), CVs or resumes (4.1), active coaching programs (1.2). Boundary: completed academic work and education belongs here as part of identity. Active personal growth coaching goes in 1.2.' },
  '1.2_FLOURISHING_SELF': { description: 'Vision of who you are growing into, and the coaching programs supporting that growth. Each program gets its own subfolder. Includes: coaching program materials, psychotherapy notes, personal development workbooks, goal-setting frameworks, transformation tracking. Does NOT include: files mentioning "partner" that came from a coaching program — those stay here even if the name says "partner." Business leadership development (4.2), content shoots from events (4.3), product files for distribution (4.4), academic coursework (1.1). Boundary: if CONSUMING material as a participant, it goes here. If you CREATED it as a product, it goes in 4.4.' },
  '1.3_SYSTEMS_&_STRUCTURES': { description: 'Routines, frameworks, protocols, and ALL recurring reviews. Includes: daily reviews, weekly reviews, monthly reviews, quarterly reviews, annual reviews, morning and evening routines, annual planning frameworks, habit trackers, knowledge management docs, personal user manuals, time-blocking templates. Does NOT include: business SOPs (4.1), marketing systems (4.6), financial tracking (4.9), coaching frameworks being learned (1.2), one-off life reflections (1.0). Boundary: if it runs on a schedule or follows a repeating template, it belongs here. One-off reflections go in 1.0.' },

  // BODY
  '2.0_BODY': { description: 'Master pillar for physical health and energy. Files here span eating, recovery, and movement together. Includes: general wellness resources, holistic health articles, energy management notes. Does NOT include: specific meal plans (2.1), doctor records or sleep protocols (2.2), workout plans (2.3), mental health or therapy notes (1.2).' },
  '2.1_EATING_&_NUTRITION': { description: 'Food, supplements, and nutritional strategy. Includes: meal plans, grocery lists, personal recipes, supplement protocols, nutrition research, food journals, dietary guidelines, food sensitivity results. Does NOT include: recipe files packaged as a product for distribution (4.4), restaurant or food travel content (3.4).' },
  '2.2_REST_&_RECOVERY': { description: 'Where the body rebuilds. Sleep, stress management, medical care, recovery. Includes: sleep rituals, recovery routines, health appointments, physician notes, lab results, prescriptions, physiotherapy notes, rehabilitation course materials, progress photos, illness logs. Does NOT include: workout plans (2.3), mental health therapy (1.2), health insurance claims (4.9). Boundary: repairing, healing, or resting the body goes here. Building strength or fitness goes in 2.3.' },
  '2.3_MOVEMENT': { description: 'Keeping the body strong and mobile. Includes: workout programs, training splits, mobility routines, stretching protocols, fitness logs, exercise notes, gym tracking, cardio logs. Does NOT include: physiotherapy or rehab (2.2), sports hobbies or recreation leagues (3.4), business B-roll of physical activities (4.3).' },

  // SOUL
  '3.0_SOUL': { description: 'Master pillar for personal life beyond work. Relationships, hobbies, wealth, life admin. Files here span multiple Soul sub-pillars. Includes: life balance reflections, gratitude journals, life satisfaction assessments. Does NOT include: work or business files (4.0+), coaching or personal development (1.2), health files (2.0+).' },
  '3.1_PERSONAL_ADMIN': { description: 'Logistics of daily personal life. Includes: housing documents (leases, utility bills, maintenance), vehicle records, personal passwords and account lists, personal legal documents (will, power of attorney), ID and passport scans, personal keepsakes. Does NOT include: business legal documents (4.1), investments or wealth strategy (3.5), health insurance or medical billing (4.9 or 2.2), branding or design assets (4.5).' },
  '3.2_COMMUNITY': { description: 'Personal relationships and network. Not professional contacts. Includes: notes on friends and family, personal network maps, connection tracking, community involvement, friendship milestones. Does NOT include: romantic partner files (3.3), client relationships (4.8), team or employee relationships (4.2), real estate (3.5), housing docs (3.1).' },
  '3.3_PARTNER': { description: 'Romantic relationship. Shared vision, values, goals, and personal media between partners. Includes: partner values exercises (created personally, not from coaching), relationship vision docs, shared goal trackers, couple milestones, relationship photos and personal media, date planning, love language notes. Does NOT include: coaching program worksheets mentioning "partner" — if from any coaching curriculum, it stays in 1.2. Business partnership agreements (4.1). Client files (4.8). Friendship files (3.2). Boundary: the word "partner" in a file name does NOT automatically mean it belongs here. Check the folder path — if inside a coaching program folder, it is a coaching exercise and stays in 1.2.' },
  '3.4_TRAVEL_&_HOBBIES': { description: 'Exploration, play, and creative hobbies outside work. Includes: travel itineraries, trip planning, packing lists, hobby project files (DJing, music production, playlists), bucket lists, adventure logs, soundscape collections. Does NOT include: business content shoots at travel locations (4.3), business travel expenses (4.9), wellness retreats focused on health (2.2).' },
  '3.5_WEALTH': { description: 'Personal financial freedom and long-term stability. Includes: investment portfolio docs, real estate documents, wealth strategy notes, net worth tracking, passive income planning, personal financial goals, retirement planning. Does NOT include: business invoices or accounting (4.9), business bank statements (4.9), personal lease as a tenant (3.1). Boundary: personal wealth growth and investment strategy goes here. Business revenue, expenses, or tax records go in 4.9.' },

  // PURPOSE
  '4.0_PURPOSE': { description: 'Master pillar for career, business, and professional craft. Files here span multiple work sub-pillars. Includes: career vision docs, general work reflections, purpose statements. Does NOT include: personal development or coaching (1.2), personal admin (3.1), personal financial planning (3.5).' },
  '4.1_BUSINESS_ADMIN': { description: 'Operational backbone. Legal, administrative, and structural documents for running business entities. Includes: incorporation documents, legal agreements, meeting notes, AI training materials, CVs, corporate records (tax slips, legal docs, accounts), operational program records (operator agreements, wage subsidies, health and safety, workers comp, profit tracking, team training docs). Does NOT include: recruiting or interviews (4.2), marketing or sales materials (4.6, 4.7), client folders (4.8), invoices or tax records (4.9), personal admin (3.1). Boundary: legal structure and operations go here. Money flowing in or out goes in 4.9. People management goes in 4.2.' },
  '4.2_LEADERSHIP': { description: 'Guiding yourself and others. People development, team building, recruiting. Includes: coaching frameworks for team members, leadership notes, team tools, recruiting materials, interview templates, employee onboarding guides, mentorship notes. Does NOT include: client management (4.8 — clients are not team members), business operations docs (4.1), sales conversations (4.7), payroll or financial records (4.9), personal coaching programs (1.2). Boundary: developing, hiring, or leading team members goes here. Serving clients goes in 4.8. Personal growth coaching goes in 1.2.' },
  '4.3_CONTENT_&_RESEARCH': { description: 'Creative lab. Where raw content is created and captured before becoming a product or marketing material. Includes: photo and video shoots, social media visuals, content creation projects, research notes, Zoom recording assets, B-roll footage, preset and LUT packs, bloopers and final cuts, content incubator materials, media assets for business. Does NOT include: finished products for distribution (4.4), logos and fonts (4.5), marketing strategy docs (4.6), personal hobby or travel photos (3.4), partner relationship photos (3.3), coaching materials consumed as a student (1.2), academic coursework (1.1). Boundary: if you CREATED it as business content, it goes here. If CONSUMING as a student, it goes in 1.2. If it is formal academic work, it goes in 1.1. If packaged for sale, it goes in 4.4.' },
  '4.4_PRODUCT_&_DISTRIBUTION': { description: 'Where ideas become tangible offerings. Finished products and distribution systems. Includes: template assets, recipe or resource files packaged for distribution, tutorial videos, production files, offer maps, product launch checklists. Does NOT include: raw content or shoots (4.3), brand guidelines or logos (4.5), marketing campaigns (4.6), sales scripts (4.7), completed education courses (1.1). Boundary: if it IS the product or directly supports delivering it, it goes here. If it PROMOTES the product, it goes in 4.6. If it is raw content not yet packaged, it goes in 4.3.' },
  '4.5_BRANDING': { description: 'Visual identity and brand presentation. Includes: logos (all versions), fonts, banners, design assets, brand guidelines, color palettes, mood boards, visual identity documents, brand kit assets. Does NOT include: social media content for posts (4.3), marketing copy or campaigns (4.6), client-specific branding work (4.8 under client folder).' },
  '4.6_MARKETING': { description: 'Getting work in front of the right people. Campaigns, funnels, audience strategy. Includes: campaign plans, funnel documents, audience strategy, email marketing templates, ad copy, social media strategy docs (the strategy, not visuals), analytics reports, promotional materials. Does NOT include: raw creative assets (4.3), sales scripts or calls (4.7), logos (4.5), client deliverables (4.8). Boundary: marketing attracts attention and generates interest. Sales closes the deal. Reaching people = marketing. Converting a specific prospect = sales (4.7).' },
  '4.7_SALES': { description: 'Converting interest into commitment. Includes: sales scripts, call recordings and notes, pipeline tracking, proposal templates, pricing documents, negotiation notes, follow-up templates, close rate tracking. Does NOT include: marketing campaigns (4.6), client onboarding after the sale (4.8), invoices or payment records (4.9), general business strategy (4.1). Boundary: once a prospect becomes a client, their files move to 4.8. Sales is the pipeline before conversion.' },
  '4.8_CLIENT_MANAGEMENT': { description: 'Working relationship with active clients. Each client gets a FIRSTNAME_LASTNAME subfolder. Client folders hold project files, deliverables, contracts, and communication — but NOT financial records. Includes: onboarding documents, project files, contracts, communication logs, deliverables, media, logos, creative assets, shared access folders. Does NOT include: recruiting or team files (4.2 — employees are not clients), sales materials before conversion (4.7), invoices and financial records (4.9 — all financial records go there for tax reconciliation). Boundary: client folders hold the working relationship. Financial records (invoices, payments, commissions) go in 4.9 under the appropriate fiscal year.' },
  '4.9_FINANCIALS': { description: 'ALL business financial records in one place, organized by fiscal year for tax reconciliation. Includes: all invoices (general business AND client-specific), bank statements by year, credit card statements, tax records, cash receipts, bookkeeping exports, accounting software backups, insurance claims, bank agreements, financial templates, expense reports, year folders. Does NOT include: personal investments (3.5), personal expense tracking (3.1), operational payroll and wage subsidy docs (4.1). Boundary: every financial record ends up here, including client invoices. Client folders in 4.8 hold projects and deliverables. Financial records live here for accounting and tax purposes.' },

  // SYSTEM
  '0_NEEDS_REVIEW': { description: 'Holding area for files the system cannot confidently classify. Nothing stays permanently. Includes: files below 70% confidence, ambiguous names spanning multiple pillars, old account files needing manual sorting, age-flagged files. Does NOT include: duplicates or obsolete files (00_PENDING_DELETION), files with messy names but clear classification from folder context.' },
  '00_PENDING_DELETION': { description: 'Staging area for duplicates, obsolete, or unneeded files. Nothing deleted automatically — owner reviews first. Includes: confirmed duplicates (matching name + size with newer copy), explicitly outdated files, "Copy of" files where original exists, empty or zero-byte files. Does NOT include: old files that are still valid records — age alone is never a reason to delete. Misplaced files get moved, not deleted.' }
};

/**
 * Abbreviation map for naming convention standardization
 */
const ABBREVIATIONS = {
  'STATEMENT': 'STMNT',
  'STATEMENTS': 'STMNTS',
  'DOCUMENT': 'DOC',
  'DOCUMENTS': 'DOCS',
  'AGREEMENT': 'AGMT',
  'AGREEMENTS': 'AGMTS',
  'MANAGEMENT': 'MGMT',
  'PRODUCTION': 'PROD',
  'MARKETING': 'MKTG',
  'RECRUITING': 'RECRUIT',
  'INVOICES': 'INV',
  'INVOICING': 'INV',
  'FINANCIAL': 'FIN',
  'FINANCIALS': 'FIN',
  'INSURANCE': 'INSUR',
  'BUSINESS': 'BIZ',
  'COMMISSION': 'COMM',
  'TRACKING': 'TRKG',
  'TRAINING': 'TRNG',
  'TEMPLATES': 'TMPL',
  'TEMPLATE': 'TMPL',
  'ACCOUNTS': 'ACCTS',
  'ACCOUNT': 'ACCT',
  'REIMBURSEMENT': 'REIMB',
  'REIMBURSEMENTS': 'REIMBS',
  'EMPLOYEE': 'EMP',
  'EMPLOYEES': 'EMPS',
  'UNIVERSITY': 'UNI',
  'MISCELLANEOUS': 'MISC',
  'DOCUMENTATION': 'DOCS',
  'INFORMATION': 'INFO',
  'VERSION': 'V',
  'QUARTERLY': 'QTR',
  'MONTHLY': 'MO',
  'ANNUAL': 'ANN',
  'VIDEO': 'VID',
  'CONTENT': 'CNTNT'
};

/**
 * Known subfolder structure for each pillar.
 * The classification AI is constrained to ONLY these names (or "ROOT" for the pillar top level).
 * This prevents the AI from inventing phantom folder names.
 * Update this when you add or rename subfolders in the hierarchy.
 */
const KNOWN_SUBFOLDERS = {
  '1.0_MIND': [],
  '1.1_CURRENT_SELF': ['EDUCATION'],
  '1.2_FLOURISHING_SELF': ['COACHING_PROGRAM_A', 'COACHING_PROGRAM_B', 'PSYCHOTHERAPY'],
  '1.3_SYSTEMS_&_STRUCTURES': [],
  '2.0_BODY': [],
  '2.1_EATING_&_NUTRITION': [],
  '2.2_REST_&_RECOVERY': ['PROGRESS_PHOTOS', 'MEDICAL_RECORDS', 'REHAB_COURSE'],
  '2.3_MOVEMENT': [],
  '3.0_SOUL': [],
  '3.1_PERSONAL_ADMIN': ['HOUSING_DOCUMENTS', 'VEHICLES'],
  '3.2_COMMUNITY': [],
  '3.3_PARTNER': [],
  '3.4_TRAVEL_&_HOBBIES': ['MUSIC_PROJECTS', 'TRIP_PLANNING'],
  '3.5_WEALTH': ['REAL_ESTATE', 'PHOTOS'],
  '4.0_PURPOSE': [],
  '4.1_BUSINESS_ADMIN': ['AI_TRNG', 'CV_DRAFTS', 'COMPANY_NAME_INC', 'OPERATING_PROGRAM_NAME'],
  '4.2_LEADERSHIP': ['RECRUITING'],
  '4.3_CONTENT_&_RESEARCH': ['CNTNT_SHOOTS', 'ZOOM_REC_ASSETS', 'SOCIAL_MEDIA_PHOTOS', 'SOCIAL_MEDIA_VISUALS'],
  '4.4_PRODUCT_&_DISTRIBUTION': ['NOTION_ASSETS', 'PRODUCT_ASSETS', 'TUTORIAL_VIDS'],
  '4.5_BRANDING': ['LOGOS', 'FONTS', 'BANNERS', 'ASSETS'],
  '4.6_MARKETING': ['CAMPAIGNS'],
  '4.7_SALES': ['PIPELINE'],
  '4.8_CLIENT_MANAGEMENT': ['CLIENT_FIRSTNAME_LASTNAME'],
  '4.9_FINANCIALS': ['CLIENT_INV', 'UTILITY_BILLS', 'INSURANCE_CLAIMS', 'BANK_AGREEMENTS', 'FIN_TMPL'],
  '0_NEEDS_REVIEW': [],
  '00_PENDING_DELETION': []
};

/**
 * DEPTH RULES — controls how deep the organization goes for each pillar.
 *
 * Each pillar maps to a depth pattern that tells the AI and the move logic
 * what additional tiers to extract beyond pillar + subCategory.
 *
 * Patterns:
 *   'flat'                — Pillar / subCategory only (no deeper sorting)
 *   'category_year'       — Pillar / subCategory / YEAR
 *   'category_entity_year'— Pillar / subCategory / ENTITY / YEAR
 *   'year_entity'         — Pillar / YEAR / ENTITY (year comes before entity)
 *
 * "entity" means the natural grouping for that context:
 *   - UTILITY_BILLS → provider (e.g., BELL, HYDRO_ONE)
 *   - CLIENT_INV → client name (JANE_DOE)
 *   - EDUCATION → institution (STATE_UNI, ART_SCHOOL)
 *   - PROGRESS_PHOTOS → just year (no entity needed)
 *   - REAL_ESTATE → property or deal name
 *
 * When a pillar's pattern includes "year" or "entity" but a specific file
 * has no extractable entity (e.g., INSURANCE_CLAIMS with no sub-entity),
 * the system skips that tier and places the file one level up.
 * This keeps the tree clean — no empty nesting.
 */
const DEPTH_RULES = {
  // MIND — shallow
  '1.0_MIND':                 { pattern: 'flat' },
  '1.1_CURRENT_SELF':         { pattern: 'category_entity_year', entityLabel: 'institution' },
  '1.2_FLOURISHING_SELF':     { pattern: 'category_year', entityLabel: null },
  '1.3_SYSTEMS_&_STRUCTURES': { pattern: 'flat' },

  // BODY — mostly shallow, REST_&_RECOVERY gets year
  '2.0_BODY':                 { pattern: 'flat' },
  '2.1_EATING_&_NUTRITION':   { pattern: 'flat' },
  '2.2_REST_&_RECOVERY':      { pattern: 'category_year', entityLabel: null },
  '2.3_MOVEMENT':             { pattern: 'flat' },

  // SOUL — mostly shallow, WEALTH gets year
  '3.0_SOUL':                 { pattern: 'flat' },
  '3.1_PERSONAL_ADMIN':       { pattern: 'flat' },
  '3.2_COMMUNITY':            { pattern: 'flat' },
  '3.3_PARTNER':              { pattern: 'flat' },
  '3.4_TRAVEL_&_HOBBIES':     { pattern: 'flat' },
  '3.5_WEALTH':               { pattern: 'category_year', entityLabel: null },

  // PURPOSE — deeper organization
  '4.0_PURPOSE':              { pattern: 'flat' },
  '4.1_BUSINESS_ADMIN':       { pattern: 'category_year', entityLabel: null },
  '4.2_LEADERSHIP':           { pattern: 'category_year', entityLabel: null },
  '4.3_CONTENT_&_RESEARCH':   { pattern: 'category_year', entityLabel: null },
  '4.4_PRODUCT_&_DISTRIBUTION': { pattern: 'category_year', entityLabel: null },
  '4.5_BRANDING':             { pattern: 'flat' },
  '4.6_MARKETING':            { pattern: 'flat' },
  '4.7_SALES':                { pattern: 'flat' },
  '4.8_CLIENT_MANAGEMENT':    { pattern: 'year_entity', entityLabel: 'client' },
  '4.9_FINANCIALS':           { pattern: 'category_entity_year', entityLabel: 'provider_or_client' },

  // SYSTEM
  '0_NEEDS_REVIEW':           { pattern: 'flat' },
  '00_PENDING_DELETION':      { pattern: 'flat' }
};

/**
 * Builds the full target path for a file based on its pillar's DEPTH_RULES pattern.
 *
 * @param {string} pillar - e.g. '4.9_FINANCIALS'
 * @param {string} subCategory - e.g. 'UTILITY_BILLS' or 'ROOT'
 * @param {string|null} entity - e.g. 'BELL' or null if not applicable
 * @param {string|null} year - e.g. '2026' or null if not extractable
 * @returns {string} Full path like '4.9_FINANCIALS/UTILITY_BILLS/BELL/2026'
 */
function buildTargetPath(pillar, subCategory, entity, year) {
  const rule = DEPTH_RULES[pillar] || { pattern: 'flat' };
  const parts = [pillar];

  switch (rule.pattern) {
    case 'flat':
      // Pillar / subCategory only
      if (subCategory && subCategory !== 'ROOT') {
        parts.push(subCategory);
      }
      break;

    case 'category_year':
      // Pillar / subCategory / YEAR
      if (subCategory && subCategory !== 'ROOT') {
        parts.push(subCategory);
      }
      if (year) {
        parts.push(year);
      }
      break;

    case 'category_entity_year':
      // Pillar / subCategory / ENTITY / YEAR
      if (subCategory && subCategory !== 'ROOT') {
        parts.push(subCategory);
      }
      if (entity) {
        parts.push(entity);
      }
      if (year) {
        parts.push(year);
      }
      break;

    case 'year_entity':
      // Pillar / YEAR / ENTITY (4.8 pattern — year before client)
      if (year) {
        parts.push(year);
      }
      if (entity) {
        parts.push(entity);
      }
      break;

    default:
      if (subCategory && subCategory !== 'ROOT') {
        parts.push(subCategory);
      }
      break;
  }

  return parts.join('/');
}

/**
 * Builds a formatted string of the known folder structure for the classification prompt.
 * @returns {string} Each pillar with its valid subfolders listed
 */
function buildFolderStructureString() {
  const lines = [];
  for (const [pillar, subs] of Object.entries(KNOWN_SUBFOLDERS)) {
    if (pillar === '0_NEEDS_REVIEW' || pillar === '00_PENDING_DELETION') continue;
    const rule = DEPTH_RULES[pillar] || { pattern: 'flat' };
    let depthHint = '';
    if (rule.pattern === 'category_year') {
      depthHint = ' [DEPTH: subCategory → YEAR]';
    } else if (rule.pattern === 'category_entity_year') {
      depthHint = ` [DEPTH: subCategory → ${(rule.entityLabel || 'ENTITY').toUpperCase()} → YEAR]`;
    } else if (rule.pattern === 'year_entity') {
      depthHint = ` [DEPTH: YEAR → ${(rule.entityLabel || 'ENTITY').toUpperCase()}]`;
    }

    if (subs.length === 0) {
      lines.push(`${pillar}: (no subfolders — use "ROOT")${depthHint}`);
    } else {
      lines.push(`${pillar}: ${subs.join(', ')}${depthHint}`);
    }
  }
  return lines.join('\n');
}

/**
 * Naming convention rules
 */
const NAMING_RULES = {
  allCaps: true,
  underscoreSeparation: true,
  noSpaces: true,
  abbreviationsApplied: true,
  specialCharsAllowed: ['&', '+']
};

/**
 * Claude API credentials
 * PREFERRED: set via menu "Setup: Set API Key" — stored in your user properties,
 * survives script re-pastes and Reset All, and never lives in the code.
 * The constant below is only a fallback for hardcoding if you insist.
 * Get API key from: https://console.anthropic.com/account/keys
 */
const CLAUDE_API_KEY = 'YOUR_CLAUDE_API_KEY_HERE';
const CLAUDE_MODEL = 'claude-sonnet-5';

/**
 * Root folder ID - all organization happens inside this folder
 * PREFERRED: set via menu "Setup: Set Root Folder" (paste the folder URL or ID).
 * Stored in user properties, survives script re-pastes and Reset All.
 * Get from URL: https://drive.google.com/drive/folders/YOUR_ROOT_FOLDER_ID_HERE
 */
const ROOT_FOLDER_ID = 'YOUR_ROOT_FOLDER_ID_HERE';

/**
 * Returns the API key: user-properties value first, hardcoded constant as fallback.
 */
function getApiKey_() {
  const propKey = PropertiesService.getUserProperties().getProperty('CLAUDE_API_KEY');
  if (propKey && propKey.length > 10) return propKey;
  return CLAUDE_API_KEY;
}

/**
 * Returns the root folder ID: user-properties value first, constant as fallback.
 */
function getRootFolderId_() {
  const propId = PropertiesService.getUserProperties().getProperty('ROOT_FOLDER_ID');
  if (propId && propId.length > 5) return propId;
  return ROOT_FOLDER_ID;
}

/**
 * Sheet names (auto-created)
 */
const LOG_SHEET_NAME = 'DRIVE_ORGANIZER_LOG';
const INVENTORY_SHEET_NAME = 'FULL_INVENTORY';
const ORG_PLAN_SHEET_NAME = 'ORGANIZATION_PLAN';
const RENAME_APPROVAL_SHEET = 'RENAME_APPROVAL';
const INBOX_FOLDER_NAME = 'TO_ORGANIZE';
const INBOX_PLAN_SHEET = 'INBOX_PLAN';
const INBOX_HISTORY_SHEET = 'INBOX_HISTORY';
const FOLDER_CLASSIFICATION_SHEET = 'FOLDER_CLASSIFICATIONS';
const MOVE_LOG_SHEET = 'MOVE_LOG';
const DUPLICATES_SHEET = 'DUPLICATES';
const RUN_SUMMARY_SHEET = 'RUN_SUMMARY';

/**
 * Graduated confidence thresholds.
 *   >= CONF_AUTO_APPROVE  → row defaults to APPROVED
 *   CONF_REVIEW_MIN..84   → row defaults to PENDING (you must actively approve)
 *   <  CONF_REVIEW_MIN    → file routed to 0_NEEDS_REVIEW instead of a pillar guess
 */
const CONF_AUTO_APPROVE = 85;
const CONF_REVIEW_MIN = 60;

/**
 * Sub-folder creation threshold.
 * Only create a sub-folder when this many files share the same category.
 * Files below threshold stay in the parent pillar folder.
 * Configurable via setupThreshold(). Default: 5.
 */
let SUBFOLDER_THRESHOLD = 5;

/**
 * File age cutoff for flagging old files.
 * Set via setupAgeCutoff(). Files modified BEFORE this date get flagged.
 */
let FILE_AGE_CUTOFF_DATE = null;

/**
 * Low-information name detection threshold (characters).
 */
const LOW_INFO_NAME_THRESHOLD = 8;

/**
 * TEST MODE: When true, every pass caps processing at TEST_MODE_LIMIT rows.
 * Toggle from the menu: "Setup: Toggle Test Mode"
 */
let TEST_MODE = false;
let TEST_MODE_LIMIT = 50;


// ============================================================================
// SECTION 1B: SETUP FUNCTIONS
// ============================================================================

/**
 * Prompts for the Claude API key and stores it in user properties.
 * Survives script re-pastes and Reset All — set it once, forget it.
 */
function setupApiKey() {
  const ui = SpreadsheetApp.getUi();
  const current = PropertiesService.getUserProperties().getProperty('CLAUDE_API_KEY');

  const response = ui.prompt(
    'Set Claude API Key',
    `API key is currently: ${current ? 'SET (ending ...' + current.slice(-4) + ')' : 'NOT SET'}\n\n` +
    'Paste your API key from console.anthropic.com/account/keys.\n' +
    'It is stored in your Google user properties — not in the code —\n' +
    'so pasting script updates will never lose it.\n\n' +
    'Type "clear" to remove the stored key.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;
  const input = response.getResponseText().trim();

  if (input.toLowerCase() === 'clear') {
    PropertiesService.getUserProperties().deleteProperty('CLAUDE_API_KEY');
    ui.alert('Stored API key removed. The script will fall back to the hardcoded constant.');
    return;
  }

  if (input.length < 20) {
    ui.alert('That does not look like a valid API key. Copy it directly from the Anthropic console.');
    return;
  }

  PropertiesService.getUserProperties().setProperty('CLAUDE_API_KEY', input);
  ui.alert('API key saved.\n\nIt lives in your user properties now — script updates will never overwrite it.');
}

/**
 * Prompts for the root folder (URL or bare ID) and stores it in user properties.
 * Survives script re-pastes and Reset All.
 */
function setupRootFolder() {
  const ui = SpreadsheetApp.getUi();
  const current = PropertiesService.getUserProperties().getProperty('ROOT_FOLDER_ID');

  const response = ui.prompt(
    'Set Root Folder',
    `Root folder is currently: ${current ? 'SET (' + current.slice(0, 8) + '...)' : 'NOT SET'}\n\n` +
    'Paste the Google Drive folder URL (or just the folder ID).\n' +
    'This is the staging folder the script organizes inside.\n\n' +
    'Type "clear" to remove the stored ID.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;
  let input = response.getResponseText().trim();

  if (input.toLowerCase() === 'clear') {
    PropertiesService.getUserProperties().deleteProperty('ROOT_FOLDER_ID');
    ui.alert('Stored root folder removed. The script will fall back to the hardcoded constant.');
    return;
  }

  // Extract the ID if a full URL was pasted
  const urlMatch = input.match(/folders\/([A-Za-z0-9_-]+)/);
  if (urlMatch) input = urlMatch[1];

  if (input.length < 10) {
    ui.alert('That does not look like a valid folder ID. Open the folder in Drive and copy the URL.');
    return;
  }

  // Verify it actually opens before saving
  try {
    const folder = DriveApp.getFolderById(input);
    PropertiesService.getUserProperties().setProperty('ROOT_FOLDER_ID', input);
    ui.alert(`Root folder saved: "${folder.getName()}"\n\nIt lives in your user properties now — script updates will never overwrite it.`);
  } catch (e) {
    ui.alert('Could not open that folder. Check the ID and that your account has access to it.');
  }
}

/**
 * Prompts user to set the sub-folder creation threshold.
 * Only clusters with this many files or more get their own sub-folder.
 */
function setupThreshold() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Set Sub-Folder Threshold',
    'Files are grouped by category during classification.\n' +
    'A sub-folder is only created when a group reaches this number.\n' +
    'Groups below the threshold stay in the parent pillar folder.\n\n' +
    'Recommended: 5\n\n' +
    'Enter a number (minimum 2):',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const num = parseInt(response.getResponseText().trim(), 10);

    if (isNaN(num) || num < 2) {
      ui.alert('Please enter a valid number (minimum 2).');
      return;
    }

    SUBFOLDER_THRESHOLD = num;
    PropertiesService.getUserProperties().setProperty('SUBFOLDER_THRESHOLD', num.toString());
    Logger.log(`Sub-folder threshold set to: ${num}`);
    ui.alert(`Threshold set to ${num}.\n\nSub-folders will only be created when ${num} or more files share a category.`);
  }
}

/**
 * Loads the saved threshold from user properties.
 * @returns {number} The threshold value
 */
function loadThreshold() {
  const saved = PropertiesService.getUserProperties().getProperty('SUBFOLDER_THRESHOLD');
  if (saved) {
    const num = parseInt(saved, 10);
    if (!isNaN(num) && num >= 2) {
      SUBFOLDER_THRESHOLD = num;
      return num;
    }
  }
  return SUBFOLDER_THRESHOLD; // default 5
}

/**
 * Prompts user to set an age cutoff date for flagging old files.
 */
function setupAgeCutoff() {
  const ui = SpreadsheetApp.getUi();

  const response = ui.prompt(
    'Set File Age Cutoff',
    'Enter the oldest date you want to KEEP without flagging.\n\n' +
    'Files last modified BEFORE this date will be flagged in 0_NEEDS_REVIEW.\n\n' +
    'Format: YYYY-MM-DD (e.g., 2023-01-01)\n' +
    'Leave blank to disable age-based flagging.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === ui.Button.OK) {
    const dateStr = response.getResponseText().trim();

    if (dateStr === '') {
      FILE_AGE_CUTOFF_DATE = null;
      PropertiesService.getUserProperties().deleteProperty('FILE_AGE_CUTOFF');
      Logger.log('Age-based flagging DISABLED');
      ui.alert('Age-based flagging has been disabled.');
      return;
    }

    const parsed = new Date(dateStr);
    if (isNaN(parsed.getTime())) {
      ui.alert('Invalid date format. Please use YYYY-MM-DD (e.g., 2023-01-01).');
      return;
    }

    FILE_AGE_CUTOFF_DATE = parsed;
    PropertiesService.getUserProperties().setProperty('FILE_AGE_CUTOFF', dateStr);
    Logger.log(`Age cutoff set to: ${dateStr}`);
    ui.alert(`Age cutoff set to ${dateStr}.\n\nFiles last modified before this date will be flagged during Pass 2.`);
  }
}

/**
 * Prompts user to toggle test mode on/off and set the row limit.
 * When active, every pass stops after processing TEST_MODE_LIMIT items.
 */
function toggleTestMode() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getUserProperties();
  const currentlyOn = props.getProperty('TEST_MODE') === 'true';
  const currentLimit = parseInt(props.getProperty('TEST_MODE_LIMIT') || '50', 10);

  const response = ui.prompt(
    'Toggle Test Mode',
    `Test mode is currently: ${currentlyOn ? 'ON (limit: ' + currentLimit + ')' : 'OFF'}\n\n` +
    'When ON, every pass caps processing at the row limit you set.\n' +
    'Great for quick iteration while polishing the script.\n\n' +
    'Enter a number to turn ON with that limit,\n' +
    'or type "off" to disable test mode:',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const input = response.getResponseText().trim().toLowerCase();

  if (input === 'off' || input === '0') {
    TEST_MODE = false;
    props.setProperty('TEST_MODE', 'false');
    props.deleteProperty('TEST_MODE_LIMIT');
    ui.alert('Test mode is now OFF. All passes will process every row.');
    Logger.log('Test mode DISABLED');
    return;
  }

  const num = parseInt(input, 10);
  if (isNaN(num) || num < 1) {
    ui.alert('Enter a valid number (minimum 1) or "off" to disable.');
    return;
  }

  TEST_MODE = true;
  TEST_MODE_LIMIT = num;
  props.setProperty('TEST_MODE', 'true');
  props.setProperty('TEST_MODE_LIMIT', num.toString());
  ui.alert(`Test mode ON.\n\nEvery pass will stop after ${num} items.`);
  Logger.log(`Test mode ENABLED — limit: ${num}`);
}

/**
 * Loads test mode settings from user properties.
 * Call at the start of any pass function.
 */
function loadTestMode() {
  const props = PropertiesService.getUserProperties();
  TEST_MODE = props.getProperty('TEST_MODE') === 'true';
  const saved = props.getProperty('TEST_MODE_LIMIT');
  if (saved) {
    const num = parseInt(saved, 10);
    if (!isNaN(num) && num >= 1) TEST_MODE_LIMIT = num;
  }
  if (TEST_MODE) {
    Logger.log(`TEST MODE ACTIVE — capping at ${TEST_MODE_LIMIT} items`);
  }
}

/**
 * Loads the saved age cutoff from user properties.
 * @returns {Date|null}
 */
function loadAgeCutoff() {
  const saved = PropertiesService.getUserProperties().getProperty('FILE_AGE_CUTOFF');
  if (saved) {
    const parsed = new Date(saved);
    if (!isNaN(parsed.getTime())) {
      FILE_AGE_CUTOFF_DATE = parsed;
      return parsed;
    }
  }
  return null;
}


// ============================================================================
// SECTION 2: PASS 1 - FULL INVENTORY SCAN (with auto-resume)
// ============================================================================

/**
 * Maximum run time per execution (in ms). Google Apps Script hard limit is 6 min.
 * We stop at 4.5 min to leave time for saving state and setting the trigger.
 */
const MAX_RUN_MS = 270000; // 4 min 30 sec

/**
 * Inventory sheet headers (constant for reuse).
 */
const INV_HEADERS = [
  'Name', 'Type', 'Parent Folder', 'Folder Path', 'MIME Type',
  'Last Modified', 'Size (bytes)', 'Is Folder', 'Child File Count', 'ID'
];

// Column index constants for FULL_INVENTORY (0-based)
const INV = {
  NAME: 0, TYPE: 1, PARENT: 2, PATH: 3, MIME: 4,
  MODIFIED: 5, SIZE: 6, IS_FOLDER: 7, CHILD_COUNT: 8, ID: 9
};

// Column index constants for FILE_CLASSIFICATIONS (0-based, matches sheet order)
// Sheet order: Year, File Name, Parent Folder, Folder Path, Confidence,
//              Target Path, Pillar, File ID, MIME Type, Sub-Category,
//              Last Modified, Note, Age Flag, Entity
const CLS = {
  AGE_FLAG: 0, YEAR: 1, NAME: 2, NOTE: 3, PILLAR: 4,
  PARENT: 5, PATH: 6, TARGET_PATH: 7, CONFIDENCE: 8, ID: 9,
  MIME: 10, SUBCAT: 11, MODIFIED: 12, ENTITY: 13
};

/**
 * PASS 1: Scans every file and folder in the root, builds a complete inventory.
 * Uses a queue-based approach with auto-resume if it hits the time limit.
 *
 * How it works:
 *   - Maintains a queue of folder IDs still to scan (saved in PropertiesService)
 *   - Processes folders one at a time, writing rows to the sheet as it goes
 *   - If time runs out, saves remaining queue and sets a 1-minute trigger to resume
 *   - When the queue is empty, scan is complete
 *
 * Run this from the menu. It will auto-continue until done.
 * The FULL_INVENTORY sheet builds up progressively — you can watch it grow.
 */
function pass1FullScan() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();
  loadTestMode();

  try {
    const ss = SpreadsheetApp.getActive();
    let invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);

    // Check if we're resuming or starting fresh
    const savedQueue = props.getProperty('SCAN_QUEUE');
    const savedPaths = props.getProperty('SCAN_PATHS');
    let queue, pathMap;

    if (savedQueue) {
      // RESUMING a previous scan
      queue = JSON.parse(savedQueue);
      pathMap = JSON.parse(savedPaths || '{}');
      Logger.log(`=== PASS 1: RESUMING SCAN (${queue.length} folders remaining) ===\n`);
    } else {
      // FRESH START
      Logger.log('=== PASS 1: FULL INVENTORY SCAN ===');
      Logger.log('Crawling all files and folders...\n');

      // Create/clear the inventory sheet
      if (!invSheet) {
        invSheet = ss.insertSheet(INVENTORY_SHEET_NAME);
      } else {
        invSheet.clear();
      }

      // Title row (row 1)
      applyBrandedTitle(invSheet, INV_HEADERS.length);

      // Header row (row 2)
      const brandedInvHeaders = INV_HEADERS.map(h => brandHeader(h));
      invSheet.appendRow(brandedInvHeaders);
      applyBrandedHeader(invSheet, 2, INV_HEADERS.length);

      // Description row (row 3)
      const invDescRow = [
        'File or folder name',
        'Doc, Sheet, PDF, Image, etc.',
        'Folder this item sits in',
        'Full path from root',
        'Google MIME type string',
        'When the file was last changed',
        'File size in bytes',
        'Yes if this row is a folder',
        'Files directly inside (folders only)',
        'Google Drive file ID'
      ];
      invSheet.appendRow(invDescRow);
      invSheet.getRange(3, 1, 1, INV_HEADERS.length)
        .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
        .setFontColor('#999999').setBackground(BRAND.LIGHT);

      invSheet.setFrozenRows(3);

      // Initialize queue with root folder
      const rootFolder = DriveApp.getFolderById(getRootFolderId_());
      const rootId = getRootFolderId_();
      queue = [rootId];
      pathMap = {};
      pathMap[rootId] = '';  // root has empty parent path
    }

    // Re-fetch sheet reference (may have been created above)
    invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);

    let fileCount = 0;
    let folderCount = 0;

    // Process queue until empty or time runs out
    while (queue.length > 0) {
      // Time check — stop if we're approaching the limit
      if (Date.now() - startTime > MAX_RUN_MS) {
        Logger.log(`\nTime limit approaching. Saving progress...`);
        Logger.log(`Folders remaining in queue: ${queue.length}`);

        // Save state for resume
        props.setProperty('SCAN_QUEUE', JSON.stringify(queue));
        props.setProperty('SCAN_PATHS', JSON.stringify(pathMap));

        // Set a trigger to auto-resume in 1 minute
        clearPass1Triggers_();
        ScriptApp.newTrigger('pass1FullScan')
          .timeBased()
          .after(60 * 1000) // 1 minute
          .create();

        Logger.log('Auto-resume trigger set. Scan will continue in ~1 minute.');
        Logger.log('You can watch the FULL_INVENTORY sheet fill in progressively.');
        return;
      }

      // Dequeue next folder
      const folderId = queue.shift();
      let folder;
      try {
        folder = DriveApp.getFolderById(folderId);
      } catch (e) {
        Logger.log(`WARNING: Could not access folder ${folderId}: ${e.message}`);
        continue;
      }

      const folderName = folder.getName();
      const parentPath = pathMap[folderId] || '';
      const currentPath = parentPath ? `${parentPath}/${folderName}` : folderName;

      // Scan files in this folder
      let directFileCount = 0;
      const rows = [];
      const fileIter = folder.getFiles();

      while (fileIter.hasNext()) {
        const file = fileIter.next();
        directFileCount++;
        fileCount++;

        const mime = file.getMimeType();
        let typeLabel = 'File';
        if (mime.includes('document') || mime.includes('word')) typeLabel = 'Doc';
        else if (mime.includes('spreadsheet') || mime.includes('excel')) typeLabel = 'Sheet';
        else if (mime.includes('presentation') || mime.includes('powerpoint')) typeLabel = 'Slides';
        else if (mime.includes('pdf')) typeLabel = 'PDF';
        else if (mime.includes('image')) typeLabel = 'Image';
        else if (mime.includes('video')) typeLabel = 'Video';
        else if (mime.includes('audio')) typeLabel = 'Audio';

        rows.push([
          file.getName(),
          typeLabel,
          folderName,
          currentPath,
          mime,
          file.getLastUpdated().toISOString(),
          file.getSize(),
          'NO',
          '',
          file.getId()
        ]);
      }

      // Log the folder itself
      folderCount++;
      rows.push([
        folderName,
        'Folder',
        parentPath.split('/').pop() || 'ROOT',
        currentPath,
        'application/vnd.google-apps.folder',
        folder.getLastUpdated().toISOString(),
        '',
        'YES',
        directFileCount,
        folder.getId()
      ]);

      // Write rows to sheet immediately (don't accumulate in memory)
      if (rows.length > 0) {
        invSheet.getRange(invSheet.getLastRow() + 1, 1, rows.length, INV_HEADERS.length).setValues(rows);
      }

      // Enqueue sub-folders
      const subFolders = folder.getFolders();
      while (subFolders.hasNext()) {
        const sub = subFolders.next();
        const subId = sub.getId();
        queue.push(subId);
        pathMap[subId] = currentPath;
      }

      // Test mode cap
      if (TEST_MODE && fileCount >= TEST_MODE_LIMIT) {
        Logger.log(`\nTEST MODE: Stopped after ${fileCount} files (limit: ${TEST_MODE_LIMIT})`);
        break;
      }

      if (folderCount % 10 === 0) {
        Logger.log(`Scanned ${folderCount} folders, ${fileCount} files so far...`);
      }
    }

    // Queue is empty — scan complete!
    // Clean up saved state and triggers
    props.deleteProperty('SCAN_QUEUE');
    props.deleteProperty('SCAN_PATHS');
    clearPass1Triggers_();

    // Set column widths — Name widest, Type tight, ID at end
    invSheet.setColumnWidth(1, 320);   // Name
    invSheet.setColumnWidth(2, 70);    // Type
    invSheet.setColumnWidth(3, 200);   // Parent Folder
    invSheet.setColumnWidth(4, 320);   // Folder Path
    invSheet.setColumnWidth(5, 200);   // MIME Type
    invSheet.setColumnWidth(6, 180);   // Last Modified
    invSheet.setColumnWidth(7, 100);   // Size (bytes)
    invSheet.setColumnWidth(8, 80);    // Is Folder
    invSheet.setColumnWidth(9, 80);    // Child File Count
    invSheet.setColumnWidth(10, 320);  // ID

    // Apply body formatting to data rows only (row 4+), preserving title/header/description
    const lastDataRow = invSheet.getLastRow();
    if (lastDataRow >= 4) {
      applyBrandedBody(invSheet, 4, lastDataRow - 3, INV_HEADERS.length);
    }

    // Re-apply header formatting (in case body formatting bled over)
    applyBrandedHeader(invSheet, 2, INV_HEADERS.length);

    Logger.log(`\n=== SCAN COMPLETE ===`);
    Logger.log(`Total files: ${fileCount}`);
    Logger.log(`Total folders: ${folderCount}`);
    Logger.log('Review the FULL_INVENTORY sheet, then run Pass 2.');

    SpreadsheetApp.getUi().alert(
      'Pass 1 Complete',
      `Inventory scan finished.\n\nFiles: ${fileCount}\nFolders: ${folderCount}\n\nReview the FULL_INVENTORY sheet, then run Pass 2.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in pass1FullScan: ${error.message}`);
    Logger.log(error.stack);

    // Save state on error too, so it can resume
    if (props.getProperty('SCAN_QUEUE')) {
      Logger.log('State saved. You can re-run Pass 1 to resume from where it stopped.');
    }
  }
}

/**
 * Clears any existing auto-resume triggers for Pass 1.
 * Called internally when scan completes or restarts.
 */
function clearPass1Triggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'pass1FullScan') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * Manually resets Pass 1 scan state. Use if the scan gets stuck.
 * Clears the queue and triggers so you can start fresh.
 */
function resetPass1() {
  PropertiesService.getUserProperties().deleteProperty('SCAN_QUEUE');
  PropertiesService.getUserProperties().deleteProperty('SCAN_PATHS');
  clearPass1Triggers_();
  Logger.log('Pass 1 state cleared. You can run a fresh scan now.');
  SpreadsheetApp.getUi().alert('Pass 1 state has been reset. Run Pass 1 again for a fresh scan.');
}


// ============================================================================
// SECTION 3: PASS 2 - AI CLASSIFICATION + ORGANIZATION PLAN
// ============================================================================

/**
 * Classification results sheet name (intermediate step for Pass 2).
 * Stores per-file classification results so the API work can resume.
 */
const CLASSIFICATION_SHEET_NAME = 'FILE_CLASSIFICATIONS';

/**
 * PASS 2A: Classify all files using Claude API.
 * This is the slow part (API calls). It auto-resumes if it hits the time limit.
 * Results are saved to a FILE_CLASSIFICATIONS sheet row by row.
 *
 * Run this first. Once complete, run Pass 2B to build the organization plan.
 */
function pass2aClassify() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();
  loadTestMode();

  try {
    const ss = SpreadsheetApp.getActive();
    const ageCutoff = loadAgeCutoff();

    // Read inventory
    const invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    if (!invSheet || invSheet.getLastRow() < 2) {
      Logger.log('ERROR: No inventory found. Run Pass 1 first.');
      SpreadsheetApp.getUi().alert('No inventory found. Run Pass 1 (Full Scan) first.');
      return;
    }

    const invData = invSheet.getDataRange().getValues();

    // Parse files only (skip title, header, description rows)
    const allInvFiles = [];
    for (let i = 3; i < invData.length; i++) {
      const row = invData[i];
      if (row[INV.IS_FOLDER] === 'YES') continue; // skip folders
      allInvFiles.push({
        id: row[INV.ID],
        name: row[INV.NAME],
        type: row[INV.TYPE],
        mimeType: row[INV.MIME],
        parentFolder: row[INV.PARENT],
        folderPath: row[INV.PATH],
        lastModified: new Date(row[INV.MODIFIED]),
        size: row[INV.SIZE]
      });
    }

    // Skip files inside intact-moving folders — they travel with the folder
    // (run "Pass 2A: Classify Folders" first to populate FOLDER_CLASSIFICATIONS)
    const intactFolders = readIntactFolderMoves_();
    let skippedWithFolder = 0;
    const files = allInvFiles.filter(f => {
      const p = (f.folderPath || '').toString();
      for (const intactF of intactFolders) {
        if (p === intactF.folderPath || p.startsWith(intactF.folderPath + '/')) {
          skippedWithFolder++;
          return false;
        }
      }
      return true;
    });
    if (skippedWithFolder > 0) {
      Logger.log(`Skipping ${skippedWithFolder} files inside ${intactFolders.length} intact-moving folders (they move with their folder).`);
    }

    // Check if resuming
    const savedIndex = parseInt(props.getProperty('CLASSIFY_INDEX') || '0', 10);

    // Create/prepare classifications sheet
    let classSheet = ss.getSheetByName(CLASSIFICATION_SHEET_NAME);
    if (savedIndex === 0) {
      // Fresh start
      if (!classSheet) {
        classSheet = ss.insertSheet(CLASSIFICATION_SHEET_NAME);
      } else {
        classSheet.clear();
      }
      const classHeaders = ['Age Flag', 'Year', 'File Name', 'Note', 'Pillar', 'Parent Folder',
                            'Folder Path', 'Target Path', 'Confidence', 'File ID', 'MIME Type',
                            'Sub-Category', 'Last Modified', 'Entity'];

      // Title row (row 1)
      applyBrandedTitle(classSheet, classHeaders.length);

      // Header row (row 2)
      const brandedClassHeaders = classHeaders.map(h => brandHeader(h));
      classSheet.appendRow(brandedClassHeaders);
      applyBrandedHeader(classSheet, 2, classHeaders.length);

      // Description row (row 3)
      const classDescRow = [
        'Marked if file is older than cutoff',
        'Year extracted from file',
        'Original file name',
        'Flags, warnings, or context',
        'Which sub-pillar this file belongs to',
        'Folder this file currently sits in',
        'Full current path from root',
        'Full destination path after organization',
        'AI confidence score (0-100)',
        'Google Drive file ID',
        'Google file type',
        'Subfolder within the pillar',
        'When the file was last changed',
        'Provider, client, or institution name'
      ];
      classSheet.appendRow(classDescRow);
      classSheet.getRange(3, 1, 1, classHeaders.length)
        .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
        .setFontColor('#999999').setBackground(BRAND.LIGHT);

      classSheet.setFrozenRows(3);

      // Column widths
      classSheet.setColumnWidth(1, 80);    // Age Flag
      classSheet.setColumnWidth(2, 70);    // Year
      classSheet.setColumnWidth(3, 280);   // File Name
      classSheet.setColumnWidth(4, 250);   // Note
      classSheet.setColumnWidth(5, 180);   // Pillar
      classSheet.setColumnWidth(6, 180);   // Parent Folder
      classSheet.setColumnWidth(7, 250);   // Folder Path
      classSheet.setColumnWidth(8, 300);   // Target Path
      classSheet.setColumnWidth(9, 90);    // Confidence
      classSheet.setColumnWidth(10, 300);  // File ID
      classSheet.setColumnWidth(11, 180);  // MIME Type
      classSheet.setColumnWidth(12, 160);  // Sub-Category
      classSheet.setColumnWidth(13, 180);  // Last Modified
      classSheet.setColumnWidth(14, 140);  // Entity
      Logger.log(`=== PASS 2A: CLASSIFYING ${files.length} FILES ===\n`);
      Logger.log(`Age cutoff: ${ageCutoff ? ageCutoff.toISOString().split('T')[0] : 'disabled'}\n`);
    } else {
      classSheet = ss.getSheetByName(CLASSIFICATION_SHEET_NAME);
      Logger.log(`=== PASS 2A: RESUMING CLASSIFICATION (from file ${savedIndex + 1} of ${files.length}) ===\n`);
    }

    // Build pillar descriptions for prompt
    const pillarDesc = {};
    for (const [key, spec] of Object.entries(PILLAR_ANCHORS)) {
      pillarDesc[key] = spec.description;
    }

    // Process files in batches of 10
    const batchSize = 10;
    let i = savedIndex;

    while (i < files.length) {
      // Test mode cap
      if (TEST_MODE && i >= TEST_MODE_LIMIT) {
        Logger.log(`\nTEST MODE: Stopped after ${i} files (limit: ${TEST_MODE_LIMIT})`);
        break;
      }

      // Time check
      if (Date.now() - startTime > MAX_RUN_MS) {
        props.setProperty('CLASSIFY_INDEX', i.toString());
        clearPass2aTriggers_();
        ScriptApp.newTrigger('pass2aClassify')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at file ${i}/${files.length}. Auto-resuming in ~1 minute.`);
        return;
      }

      const batch = files.slice(i, i + batchSize);
      const rawRows = classifyBatch(batch, pillarDesc, ageCutoff);

      // Remap from classifyBatch output order to sheet column order.
      // classifyBatch returns: [0]Name, [1]Pillar, [2]SubCat, [3]TargetPath,
      //   [4]Confidence, [5]Entity, [6]Year, [7]Note, [8]AgeFlag,
      //   [9]Parent, [10]Path, [11]MIME, [12]Modified, [13]ID
      // Sheet order: Year, FileName, Parent, Path, Confidence,
      //   TargetPath, Pillar, FileID, MIME, SubCat, Modified, Note, AgeFlag, Entity
      const rows = rawRows.map(r => [
        r[8], r[6], r[0], r[7], r[1],
        r[9], r[10], r[3], r[4], r[13],
        r[11], r[2], r[12], r[5]
      ]);

      // Write rows to sheet
      if (rows.length > 0) {
        classSheet.getRange(classSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      }

      i += batchSize;

      if (i % 50 === 0 || i >= files.length) {
        Logger.log(`Classified ${Math.min(i, files.length)} / ${files.length} files`);
      }

      // Pause between batches to avoid rate limits
      Utilities.sleep(1500);
    }

    // Classification complete!
    props.deleteProperty('CLASSIFY_INDEX');
    clearPass2aTriggers_();

    Logger.log(`\n=== CLASSIFICATION COMPLETE ===`);
    Logger.log(`${files.length} files classified${skippedWithFolder > 0 ? ` (${skippedWithFolder} skipped — moving with their folder)` : ''}.`);
    Logger.log('Now run Pass 2C: Build Organization Plan.');

    SpreadsheetApp.getUi().alert(
      'File Classification Complete',
      `${files.length} files classified.${skippedWithFolder > 0 ? `\n${skippedWithFolder} files skipped (moving with their folder).` : ''}\n\nNow run "Pass 2C: Build Organization Plan" from the menu.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in pass2aClassify: ${error.message}`);
    Logger.log(error.stack);
    // Save progress on error
    Logger.log('Progress saved. Re-run Pass 2A to resume.');
  }
}

/**
 * Peeks at the first ~300 characters of a Google-native file's content.
 * Returns '' for non-Google files (PDFs, images, videos) or on any access error.
 * Used by classification so the AI reads content instead of guessing from names.
 */
function getContentSnippet_(fileId, mimeType) {
  const MAX_CHARS = 300;
  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      const doc = DocumentApp.openById(fileId);
      return doc.getBody().getText().substring(0, MAX_CHARS).replace(/\s+/g, ' ').trim();
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const ss = SpreadsheetApp.openById(fileId);
      const firstSheet = ss.getSheets()[0];
      if (firstSheet.getLastRow() < 1 || firstSheet.getLastColumn() < 1) return '';
      const range = firstSheet.getRange(1, 1, Math.min(4, firstSheet.getLastRow()), Math.min(5, firstSheet.getLastColumn()));
      return range.getValues().map(row => row.join(' | ')).join(' / ').substring(0, MAX_CHARS);
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      const pres = SlidesApp.openById(fileId);
      const slides = pres.getSlides();
      if (slides.length === 0) return '';
      const shapes = slides[0].getShapes();
      return shapes.map(s => {
        try { return s.getText().asString(); } catch (e) { return ''; }
      }).filter(t => t.length > 0).join(' | ').substring(0, MAX_CHARS).replace(/\s+/g, ' ').trim();
    }
  } catch (peekError) {
    return '';
  }
  return '';
}

/**
 * Classifies a batch of files and returns sheet rows.
 * Uses KNOWN_SUBFOLDERS to constrain sub-category choices.
 * Peeks at content of Google-native files so classification reads, not guesses.
 */
function classifyBatch(batch, pillarDesc, ageCutoff) {
  const rows = [];

  const folderStructure = buildFolderStructureString();

  const fileList = batch.map((f, idx) => {
    const ageFlag = ageCutoff && f.lastModified < ageCutoff;
    const snippet = getContentSnippet_(f.id, f.mimeType);
    const contentPart = snippet ? ` | Content: "${snippet}"` : '';
    return `${idx + 1}. Name: "${f.name}" | Type: ${f.mimeType} | Folder: "${f.parentFolder}" | Path: "${f.folderPath}" | Modified: ${f.lastModified.toISOString().split('T')[0]}${ageFlag ? ' [OLD FILE]' : ''}${contentPart}`;
  }).join('\n');

  const prompt = `You are a filing system expert. Classify each file using a TWO-STAGE process:

STAGE 1 — Pick the MASTER PILLAR (1.0 MIND, 2.0 BODY, 3.0 SOUL, or 4.0 PURPOSE) based on the file's content and context. Use the master pillar descriptions to decide which domain the file belongs to.

STAGE 2 — Within that master pillar, pick the specific SUB-PILLAR (e.g., 1.1, 1.2, 2.1, 4.9) that best fits the file. Use the sub-pillar descriptions to narrow down. Then determine the sub-category, entity, and year.

CRITICAL RULE: Files must NEVER be classified to a master pillar directly (1.0_MIND, 2.0_BODY, 3.0_SOUL, 4.0_PURPOSE). These are sorting headers only, not destinations. Every file MUST land in a numbered sub-pillar (1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1-3.5, 4.1-4.9). If you cannot determine the right sub-pillar, use "0_NEEDS_REVIEW".

OUTPUT FIELDS:
1. A DISPOSITION — triage decision made BEFORE classification:
   - "KEEP" — a real, current file that belongs somewhere in the structure
   - "DELETE" — a confirmed duplicate ("Copy of..." where original exists), superseded version, zero-byte file, or explicitly obsolete content. Will be staged in 00_PENDING_DELETION for owner review, never auto-deleted.
   - "REVIEW" — genuinely ambiguous: could belong to multiple pillars, or you cannot tell what it is. Will be staged in 0_NEEDS_REVIEW.
2. A PILLAR — must be a sub-pillar key (e.g., "4.9_FINANCIALS"), NEVER a master pillar (e.g., "4.0_PURPOSE"). Only meaningful when disposition is KEEP.
3. A SUB-CATEGORY — must be "ROOT" or one of the EXACT subfolder names listed for that pillar below. Do NOT invent new names.
4. An ENTITY — where applicable, see DEPTH hints in the folder structure below
5. A YEAR — 4-digit year extracted from the file name, path, or best guess from modified date
6. A CONFIDENCE — your HONEST confidence 0-100. Do not inflate. Files WITH a Content preview justify higher confidence. Files WITHOUT a preview (PDFs, images, videos) are being judged on name and folder alone — cap confidence at 75 for these unless the name is unambiguous (e.g., "2023_TAX_RETURN.pdf").

PILLAR OPTIONS (with descriptions):
${JSON.stringify(pillarDesc, null, 2)}

EXISTING SUBFOLDER STRUCTURE (use ONLY these exact names or "ROOT"):
${folderStructure}

DEPTH RULES EXPLAINED:
- [DEPTH: subCategory → YEAR] means files go into a year folder inside their subcategory. Example: 1.2_FLOURISHING_SELF/COACHING_PROGRAM_A/2025/
- [DEPTH: subCategory → ENTITY → YEAR] means files go entity-then-year inside their subcategory. Example: 4.9_FINANCIALS/UTILITY_BILLS/BELL/2026/
- [DEPTH: YEAR → ENTITY] means year comes first, then entity. Example: 4.8_CLIENT_MANAGEMENT/2026/JANE_DOE/
- Pillars with no DEPTH tag are flat — subCategory is the deepest level.

ENTITY EXTRACTION RULES:
- For 4.9_FINANCIALS subcategories: entity is the provider or client name. UTILITY_BILLS → extract provider name. CLIENT_INV → extract client name (FIRSTNAME_LASTNAME format).
- For 4.8_CLIENT_MANAGEMENT: entity is the client name (FIRSTNAME_LASTNAME format from the known subfolder list).
- For 1.1_CURRENT_SELF/EDUCATION: entity is the institution name (e.g., STATE_UNI).
- For all other deep pillars: entity is null unless clearly extractable.
- Entity names should be ALL_CAPS with underscores. Use abbreviations from the naming convention where applicable.
- If you cannot confidently extract an entity, set it to null. The file will land one tier higher.

YEAR EXTRACTION RULES:
- Look for 4-digit years (2018-2030) in the file name first, then the folder path.
- Only use the modified-date year as a fallback for RECURRING or TIME-SENSITIVE documents: financial records, medical records, tax filings, invoices, receipts, pay stubs, insurance documents, annual reports, coaching program materials tied to a specific cohort, client deliverables, and similar docs that accumulate each year and need year-based sorting.
- Do NOT assign a year to general reference documents, templates, evergreen guides, educational resources, or informational PDFs that have no date in their title. These are timeless and should NOT go in a year folder. Set year to null for these.
- If the file name contains a person's name but no date, that alone does not justify a year folder. Only assign a year when the content is clearly tied to a specific time period.
- Year is always a 4-digit string like "2025", never a folder name like "2025_CLIENT_INV".

FILES TO CLASSIFY:
${fileList}

CLASSIFICATION RULES:
- Pillar must be one of the exact keys listed above.
- Sub-category must be either "ROOT" (file goes at the pillar top level) or one of the EXACT subfolder names listed under that pillar. Do NOT invent new category names like "RELATIONSHIP_VISUALS" or "TELECOM_BILLS" — if no subfolder matches, use "ROOT".
- Weight the Content preview heavily when present — it is the actual file content and beats any guess from the file name.
- Pay close attention to the file's FOLDER PATH. If a file is already inside a pillar's subfolder hierarchy (2+ levels deep), it was placed there intentionally. Set alreadyPlaced to true.
- Files inside named coaching program folders belong to that program regardless of their file name. A file named "PARTNER_6.png" inside a coaching folder is a coaching asset, not a relationship file.
- Report honest confidence. Do NOT force an unsure file into a pillar with inflated confidence — use disposition "REVIEW" instead. Low-confidence classifications are routed to review automatically.
- Do NOT mark files as DELETE just because they are old.
- Year-organized folders in 4.9_FINANCIALS (2019, 2020, 2021, etc.) are valid placement — files already in a year folder under FINANCIALS are correctly placed.

Return ONLY a JSON array:
[
  {"index": 1, "disposition": "KEEP", "pillar": "4.9_FINANCIALS", "subCategory": "UTILITY_BILLS", "entity": "BELL", "year": "2026", "confidence": 90, "note": "", "alreadyPlaced": false},
  {"index": 2, "disposition": "KEEP", "pillar": "1.2_FLOURISHING_SELF", "subCategory": "COACHING_PROGRAM_A", "entity": null, "year": "2025", "confidence": 95, "note": "Inside coaching folder", "alreadyPlaced": true},
  {"index": 3, "disposition": "DELETE", "pillar": "00_PENDING_DELETION", "subCategory": "ROOT", "entity": null, "year": null, "confidence": 97, "note": "Copy of file, original exists", "alreadyPlaced": false},
  {"index": 4, "disposition": "REVIEW", "pillar": "0_NEEDS_REVIEW", "subCategory": "ROOT", "entity": null, "year": null, "confidence": 40, "note": "Image with no context, could be 3.3 or 4.3", "alreadyPlaced": false}
]

RESPONSE:`;

  const result = callClaudeAPI(prompt, 2500);

  if (result) {
    try {
      let jsonStr = result.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      const parsed = JSON.parse(jsonStr);

      for (const item of parsed) {
        const fileIdx = item.index - 1;
        if (fileIdx >= 0 && fileIdx < batch.length) {
          const file = batch[fileIdx];
          const ageFlag = ageCutoff && file.lastModified < ageCutoff;
          let note = item.note || '';

          // Triage disposition overrides pillar routing
          const disposition = (item.disposition || 'KEEP').toString().toUpperCase();
          if (disposition === 'DELETE') {
            item.pillar = '00_PENDING_DELETION';
            item.subCategory = 'ROOT';
            note = (note ? note + ' | ' : '') + 'TRIAGE: DELETE';
          } else if (disposition === 'REVIEW') {
            item.pillar = '0_NEEDS_REVIEW';
            item.subCategory = 'ROOT';
            note = (note ? note + ' | ' : '') + 'TRIAGE: REVIEW';
          }

          // Graduated confidence: below CONF_REVIEW_MIN routes to review, not a pillar guess
          const conf = parseInt(item.confidence, 10) || 0;
          if (disposition === 'KEEP' && conf < CONF_REVIEW_MIN &&
              item.pillar !== '00_PENDING_DELETION' && item.pillar !== '0_NEEDS_REVIEW') {
            note = (note ? note + ' | ' : '') + `LOW CONFIDENCE (${conf}) — was ${item.pillar}`;
            item.pillar = '0_NEEDS_REVIEW';
            item.subCategory = 'ROOT';
          }

          // Mark already-placed files so buildMovePlan can skip them
          if (item.alreadyPlaced) {
            note = (note ? note + ' | ' : '') + 'ALREADY_PLACED';
          }

          if (ageFlag && item.pillar !== '00_PENDING_DELETION') {
            note = (note ? note + ' | ' : '') + `AGE FLAG: ${file.lastModified.toISOString().split('T')[0]}`;
          }

          // Validate subCategory against KNOWN_SUBFOLDERS — reject invented names
          let subCat = item.subCategory || 'ROOT';
          const validSubs = KNOWN_SUBFOLDERS[item.pillar];
          if (validSubs && subCat !== 'ROOT' && !validSubs.includes(subCat)) {
            // AI invented a name not in our list — force to ROOT
            note = (note ? note + ' | ' : '') + `AI suggested "${subCat}" but not in known folders`;
            subCat = 'ROOT';
          }

          // Validate entity against known client/subfolder lists where applicable
          let entity = item.entity || null;
          if (entity) {
            entity = entity.toString().toUpperCase().replace(/\s+/g, '_');
          }

          // Extract year — validate it is a 4-digit year string
          let year = item.year || null;
          if (year) {
            year = year.toString().trim();
            if (!/^\d{4}$/.test(year)) {
              year = null; // Invalid year format, discard
            }
          }

          // Block master pillars (x.0) — these are sorting headers, not destinations
          const MASTER_PILLARS = ['1.0_MIND', '2.0_BODY', '3.0_SOUL', '4.0_PURPOSE'];
          let finalPillar = item.pillar || '0_NEEDS_REVIEW';
          if (MASTER_PILLARS.includes(finalPillar)) {
            note = (note ? note + ' | ' : '') + `Redirected from master pillar ${finalPillar}`;
            finalPillar = '0_NEEDS_REVIEW';
            subCat = 'ROOT';
          }

          // Build the full target path using DEPTH_RULES
          const targetPath = buildTargetPath(finalPillar, subCat, entity, year);

          rows.push([
            file.name,
            finalPillar,
            subCat,
            targetPath,
            item.confidence || 50,
            entity || '',
            year || '',
            note,
            ageFlag ? 'YES' : 'NO',
            file.parentFolder,
            file.folderPath,
            file.mimeType,
            file.lastModified.toISOString(),
            file.id
          ]);
        }
      }
    } catch (parseErr) {
      Logger.log(`WARNING: Parse error on batch: ${parseErr.message}`);
      for (const file of batch) {
        rows.push([file.name, '0_NEEDS_REVIEW', 'PARSE_ERROR', '0_NEEDS_REVIEW', 0,
                    '', '', 'Classification failed', 'NO', file.parentFolder, file.folderPath,
                    file.mimeType, file.lastModified.toISOString(), file.id]);
      }
    }
  } else {
    for (const file of batch) {
      rows.push([file.name, '0_NEEDS_REVIEW', 'API_ERROR', '0_NEEDS_REVIEW', 0,
                  '', '', 'API call failed', 'NO', file.parentFolder, file.folderPath,
                  file.mimeType, file.lastModified.toISOString(), file.id]);
    }
  }

  return rows;
}

/**
 * Clears auto-resume triggers for Pass 2A.
 */
function clearPass2aTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'pass2aClassify') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}


// ============================================================================
// SECTION 3B: FOLDER-LEVEL CLASSIFICATION (runs BEFORE file classification)
// ============================================================================
//
// Messy drives are messy at the folder level but usually coherent INSIDE
// folders. Moving a whole folder intact preserves the owner's mental map,
// while classifying file-by-file can scatter a folder's contents across
// four pillars. So folders are classified first, as units:
//
//   - Folders judged coherent get a MOVE_FOLDER proposal (whole folder moves)
//   - Files inside intact-moving folders are SKIPPED by file classification
//   - Only loose files and files in "mixed" folders get individual treatment
//
// Results go to the FOLDER_CLASSIFICATIONS sheet. The organization plan shows
// folder moves and individual files as two separate sections.

// Column indices for FOLDER_CLASSIFICATIONS (0-based)
const FCLS = {
  NAME: 0, INTACT: 1, PILLAR: 2, TARGET: 3, CONF: 4,
  COUNT: 5, NOTE: 6, PATH: 7, ID: 8
};

/**
 * PASS 2A: Classify candidate FOLDERS as intact units.
 * Candidates are folders living OUTSIDE the pillar structure (loose folders
 * at root, folders nested in unorganized areas). Folders already inside a
 * pillar hierarchy are considered placed and skipped.
 */
function pass2aClassifyFolders() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();
  loadTestMode();

  try {
    const ss = SpreadsheetApp.getActive();

    const invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    if (!invSheet || invSheet.getLastRow() < 2) {
      Logger.log('ERROR: No inventory found. Run Pass 1 first.');
      SpreadsheetApp.getUi().alert('No inventory found. Run Pass 1 (Full Scan) first.');
      return;
    }
    const invData = invSheet.getDataRange().getValues();

    // System folder names never treated as movable candidates
    const SYSTEM_FOLDERS = [INBOX_FOLDER_NAME, '0_NEEDS_REVIEW', '00_PENDING_DELETION'];

    // Collect candidate folders + a map of folderPath → sample file names
    const candidates = [];
    const filesByFolderPath = {};

    for (let i = 3; i < invData.length; i++) {
      const row = invData[i];
      const path = (row[INV.PATH] || '').toString();
      if (row[INV.IS_FOLDER] !== 'YES') {
        // Index file names by their containing folder path (for sampling)
        if (!filesByFolderPath[path]) filesByFolderPath[path] = [];
        if (filesByFolderPath[path].length < 12) {
          filesByFolderPath[path].push(row[INV.NAME]);
        }
        continue;
      }

      const name = (row[INV.NAME] || '').toString();
      const pathParts = path.split('/').filter(p => p.length > 0);

      // Skip the root folder itself
      if (pathParts.length <= 1) continue;

      // Skip pillar anchors and system folders
      const isPillar = Object.keys(PILLAR_ANCHORS).some(k => flexMatch(name, k));
      if (isPillar) continue;
      if (SYSTEM_FOLDERS.some(s => flexMatch(name, s))) continue;

      // Skip folders already living inside a pillar hierarchy or TO_ORGANIZE.
      // pathParts[0] is the root; pathParts[1] is the top-level container.
      if (pathParts.length >= 3) {
        const topContainer = pathParts[1];
        const insidePillar = Object.keys(PILLAR_ANCHORS).some(k => flexMatch(topContainer, k));
        const insideSystem = SYSTEM_FOLDERS.some(s => flexMatch(topContainer, s));
        if (insidePillar || insideSystem) continue;
      }

      candidates.push({
        id: row[INV.ID],
        name: name,
        folderPath: path,
        childFileCount: parseInt(row[INV.CHILD_COUNT], 10) || 0
      });
    }

    if (candidates.length === 0) {
      Logger.log('No candidate folders found — everything already lives inside the pillar structure.');
      SpreadsheetApp.getUi().alert('No loose folders to classify.\n\nAll folders already live inside the pillar structure. Run "Pass 2B: Classify Files (AI)" next.');
      return;
    }

    const savedIndex = parseInt(props.getProperty('FOLDER_CLASSIFY_INDEX') || '0', 10);

    // Create/prepare the folder classifications sheet
    let fSheet = ss.getSheetByName(FOLDER_CLASSIFICATION_SHEET);
    if (savedIndex === 0) {
      if (!fSheet) {
        fSheet = ss.insertSheet(FOLDER_CLASSIFICATION_SHEET);
      } else {
        fSheet.clear();
      }
      const fHeaders = ['Folder Name', 'Move Intact', 'Pillar', 'Target Path',
                        'Confidence', 'File Count', 'Note', 'Current Path', 'Folder ID'];

      applyBrandedTitle(fSheet, fHeaders.length);

      const brandedFHeaders = fHeaders.map(h => brandHeader(h));
      fSheet.appendRow(brandedFHeaders);
      applyBrandedHeader(fSheet, 2, fHeaders.length);

      const fDescRow = [
        'Folder being classified',
        'YES = whole folder moves as one unit',
        'Which sub-pillar it belongs to',
        'Destination parent path',
        'AI confidence score (0-100)',
        'Files directly inside',
        'Flags, warnings, or context',
        'Where the folder currently sits',
        'Google Drive folder ID'
      ];
      fSheet.appendRow(fDescRow);
      fSheet.getRange(3, 1, 1, fHeaders.length)
        .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
        .setFontColor('#999999').setBackground(BRAND.LIGHT);

      fSheet.setFrozenRows(3);

      fSheet.setColumnWidth(1, 260);  // Folder Name
      fSheet.setColumnWidth(2, 100);  // Move Intact
      fSheet.setColumnWidth(3, 180);  // Pillar
      fSheet.setColumnWidth(4, 300);  // Target Path
      fSheet.setColumnWidth(5, 90);   // Confidence
      fSheet.setColumnWidth(6, 90);   // File Count
      fSheet.setColumnWidth(7, 280);  // Note
      fSheet.setColumnWidth(8, 300);  // Current Path
      fSheet.setColumnWidth(9, 300);  // Folder ID

      Logger.log(`=== PASS 2A: CLASSIFYING ${candidates.length} FOLDERS ===\n`);
    } else {
      Logger.log(`=== PASS 2A: RESUMING FOLDER CLASSIFICATION (from ${savedIndex + 1} of ${candidates.length}) ===\n`);
    }

    // Build pillar descriptions for prompt
    const pillarDesc = {};
    for (const [key, spec] of Object.entries(PILLAR_ANCHORS)) {
      pillarDesc[key] = spec.description;
    }

    const FOLDER_BATCH = 5;
    let i = savedIndex;

    while (i < candidates.length) {
      if (TEST_MODE && i >= TEST_MODE_LIMIT) {
        Logger.log(`\nTEST MODE: Stopped after ${i} folders (limit: ${TEST_MODE_LIMIT})`);
        break;
      }

      if (Date.now() - startTime > MAX_RUN_MS) {
        props.setProperty('FOLDER_CLASSIFY_INDEX', i.toString());
        clearFolderClassifyTriggers_();
        ScriptApp.newTrigger('pass2aClassifyFolders')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at folder ${i}/${candidates.length}. Auto-resuming in ~1 minute.`);
        return;
      }

      const batch = candidates.slice(i, i + FOLDER_BATCH);
      const rows = classifyFolderBatch_(batch, pillarDesc, filesByFolderPath);

      if (rows.length > 0) {
        fSheet.getRange(fSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
      }

      i += FOLDER_BATCH;
      Logger.log(`Classified ${Math.min(i, candidates.length)} / ${candidates.length} folders`);

      Utilities.sleep(1500);
    }

    props.deleteProperty('FOLDER_CLASSIFY_INDEX');
    clearFolderClassifyTriggers_();

    // Body formatting
    const lastDataRow = fSheet.getLastRow();
    if (lastDataRow >= 4) {
      applyBrandedBody(fSheet, 4, lastDataRow - 3, 9);
    }
    applyBrandedHeader(fSheet, 2, 9);

    Logger.log(`\n=== FOLDER CLASSIFICATION COMPLETE ===`);
    Logger.log(`${candidates.length} folders classified.`);
    Logger.log('Now run "Pass 2B: Classify Files (AI)" — files inside intact-moving folders will be skipped automatically.');

    SpreadsheetApp.getUi().alert(
      'Folder Classification Complete',
      `${candidates.length} folders classified.\n\nReview the FOLDER_CLASSIFICATIONS sheet, then run "Pass 2B: Classify Files (AI)".\n\nFiles inside folders marked "Move Intact = YES" will skip individual classification — they travel with their folder.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in pass2aClassifyFolders: ${error.message}`);
    Logger.log(error.stack);
    Logger.log('Progress saved. Re-run to resume.');
  }
}

/**
 * Classifies a batch of folders as intact units via Claude API.
 * Returns FOLDER_CLASSIFICATIONS sheet rows.
 */
function classifyFolderBatch_(batch, pillarDesc, filesByFolderPath) {
  const rows = [];
  const folderStructure = buildFolderStructureString();

  const folderList = batch.map((f, idx) => {
    const samples = (filesByFolderPath[f.folderPath] || []).slice(0, 12);
    const sampleStr = samples.length > 0 ? samples.map(s => `"${s}"`).join(', ') : '(no files directly inside)';
    return `${idx + 1}. Folder: "${f.name}" | Path: "${f.folderPath}" | Direct files: ${f.childFileCount} | Sample contents: ${sampleStr}`;
  }).join('\n');

  const prompt = `You are a filing system expert. For each FOLDER below, decide whether it can move INTACT (as one unit) into the pillar structure, and where it belongs.

A folder should move intact when its contents are thematically coherent — they all serve one purpose (a photo shoot, a course, a client project, a trip). A folder should NOT move intact when its contents are a mixed bag spanning multiple life domains; those files will be classified individually instead.

OUTPUT FIELDS per folder:
1. moveIntact — true if the folder is a coherent unit that should move as-is; false if contents are mixed and files need individual sorting
2. disposition — "KEEP" (normal), "DELETE" (folder is entirely duplicates/obsolete — will be staged in 00_PENDING_DELETION for review, never auto-deleted), or "REVIEW" (cannot tell what this folder is)
3. pillar — the sub-pillar this folder belongs under (e.g., "4.3_CONTENT_&_RESEARCH"). NEVER a master pillar (1.0/2.0/3.0/4.0). Only meaningful when moveIntact is true and disposition is KEEP.
4. subCategory — "ROOT" (folder lands directly under the pillar) or one of the EXACT subfolder names for that pillar. The folder becomes a child of this location, keeping its own name.
5. confidence — honest 0-100. You are judging from the folder name and a sample of its file names. Cap at 80 unless the folder name and contents are unambiguous.
6. note — brief context or warnings

PILLAR OPTIONS (with descriptions):
${JSON.stringify(pillarDesc, null, 2)}

EXISTING SUBFOLDER STRUCTURE (use ONLY these exact names or "ROOT"):
${folderStructure}

FOLDERS TO CLASSIFY:
${folderList}

RULES:
- The folder keeps its own name — you are choosing its PARENT location.
- Coherence matters more than size. A 200-file photo-shoot folder is coherent; a 10-file "Misc" folder is not.
- A folder named after a person, program, client, trip, or project is usually coherent.
- Folders named "Stuff", "Old", "Misc", "New Folder", "Downloads" are usually NOT coherent — set moveIntact false.
- Report honest confidence. Unsure → disposition "REVIEW", not a guess.

Return ONLY a JSON array:
[
  {"index": 1, "moveIntact": true, "disposition": "KEEP", "pillar": "4.3_CONTENT_&_RESEARCH", "subCategory": "CNTNT_SHOOTS", "confidence": 85, "note": "Photo shoot folder, coherent"},
  {"index": 2, "moveIntact": false, "disposition": "KEEP", "pillar": "0_NEEDS_REVIEW", "subCategory": "ROOT", "confidence": 70, "note": "Mixed contents spanning finance and personal — classify files individually"},
  {"index": 3, "moveIntact": true, "disposition": "REVIEW", "pillar": "0_NEEDS_REVIEW", "subCategory": "ROOT", "confidence": 30, "note": "Cannot determine purpose from name or contents"}
]

RESPONSE:`;

  const result = callClaudeAPI(prompt, 1500);

  if (result) {
    try {
      let jsonStr = result.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      }
      const parsed = JSON.parse(jsonStr);

      for (const item of parsed) {
        const idx = item.index - 1;
        if (idx >= 0 && idx < batch.length) {
          const folder = batch[idx];
          let note = item.note || '';
          const conf = parseInt(item.confidence, 10) || 0;
          const disposition = (item.disposition || 'KEEP').toString().toUpperCase();
          let moveIntact = item.moveIntact === true;
          let pillar = item.pillar || '0_NEEDS_REVIEW';
          let subCat = item.subCategory || 'ROOT';

          // Dispositions override
          if (disposition === 'DELETE') {
            pillar = '00_PENDING_DELETION';
            subCat = 'ROOT';
            moveIntact = true; // whole folder staged for deletion review
            note = (note ? note + ' | ' : '') + 'TRIAGE: DELETE';
          } else if (disposition === 'REVIEW' || conf < CONF_REVIEW_MIN) {
            if (disposition !== 'REVIEW') {
              note = (note ? note + ' | ' : '') + `LOW CONFIDENCE (${conf}) — was ${pillar}`;
            } else {
              note = (note ? note + ' | ' : '') + 'TRIAGE: REVIEW';
            }
            pillar = '0_NEEDS_REVIEW';
            subCat = 'ROOT';
            moveIntact = false; // do not auto-move; files classified individually
          }

          // Block master pillars
          const MASTER_PILLARS = ['1.0_MIND', '2.0_BODY', '3.0_SOUL', '4.0_PURPOSE'];
          if (MASTER_PILLARS.includes(pillar)) {
            note = (note ? note + ' | ' : '') + `Redirected from master pillar ${pillar}`;
            pillar = '0_NEEDS_REVIEW';
            subCat = 'ROOT';
            moveIntact = false;
          }

          // Validate subCategory
          const validSubs = KNOWN_SUBFOLDERS[pillar];
          if (validSubs && subCat !== 'ROOT' && !validSubs.includes(subCat)) {
            note = (note ? note + ' | ' : '') + `AI suggested "${subCat}" but not in known folders`;
            subCat = 'ROOT';
          }

          const targetPath = buildTargetPath(pillar, subCat, null, null);

          rows.push([
            folder.name,
            moveIntact ? 'YES' : 'NO',
            pillar,
            targetPath,
            conf,
            folder.childFileCount,
            note,
            folder.folderPath,
            folder.id
          ]);
        }
      }
    } catch (parseErr) {
      Logger.log(`WARNING: Folder batch parse error: ${parseErr.message}`);
      for (const folder of batch) {
        rows.push([folder.name, 'NO', '0_NEEDS_REVIEW', '0_NEEDS_REVIEW', 0,
                    folder.childFileCount, 'Classification failed', folder.folderPath, folder.id]);
      }
    }
  } else {
    for (const folder of batch) {
      rows.push([folder.name, 'NO', '0_NEEDS_REVIEW', '0_NEEDS_REVIEW', 0,
                  folder.childFileCount, 'API call failed', folder.folderPath, folder.id]);
    }
  }

  return rows;
}

/**
 * Reads FOLDER_CLASSIFICATIONS and returns top-most intact-moving folders.
 * Nested intact folders are dropped (they travel with their parent).
 * @returns {Array} [{ id, name, folderPath, pillar, targetPath, confidence, note, fileCount }]
 */
function readIntactFolderMoves_() {
  const ss = SpreadsheetApp.getActive();
  const fSheet = ss.getSheetByName(FOLDER_CLASSIFICATION_SHEET);
  if (!fSheet || fSheet.getLastRow() < 4) return [];

  const data = fSheet.getDataRange().getValues();
  const intact = [];
  for (let i = 3; i < data.length; i++) {
    const row = data[i];
    if (!row[FCLS.NAME]) continue;
    if ((row[FCLS.INTACT] || '').toString().toUpperCase() !== 'YES') continue;
    intact.push({
      id: row[FCLS.ID],
      name: row[FCLS.NAME],
      folderPath: (row[FCLS.PATH] || '').toString(),
      pillar: row[FCLS.PILLAR],
      targetPath: (row[FCLS.TARGET] || '').toString(),
      confidence: parseInt(row[FCLS.CONF], 10) || 0,
      note: row[FCLS.NOTE] || '',
      fileCount: parseInt(row[FCLS.COUNT], 10) || 0
    });
  }

  // Keep only top-most folders: drop any whose path is inside another intact folder
  intact.sort((a, b) => a.folderPath.length - b.folderPath.length);
  const topMost = [];
  for (const f of intact) {
    const nested = topMost.some(t => f.folderPath.startsWith(t.folderPath + '/'));
    if (!nested) topMost.push(f);
  }
  return topMost;
}

/**
 * Clears auto-resume triggers for folder classification.
 */
function clearFolderClassifyTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'pass2aClassifyFolders') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * PASS 2B: Reads the classification results and builds the organization plan.
 * This is the fast part (no API calls). Produces the color-coded ORGANIZATION_PLAN sheet.
 *
 * Run this AFTER Pass 2A completes.
 */
function pass2bBuildPlan() {
  try {
    Logger.log('=== PASS 2C: BUILD ORGANIZATION PLAN ===\n');

    const threshold = loadThreshold();
    Logger.log(`Sub-folder threshold: ${threshold} files\n`);

    const ss = SpreadsheetApp.getActive();

    // Read classifications
    const classSheet = ss.getSheetByName(CLASSIFICATION_SHEET_NAME);
    if (!classSheet || classSheet.getLastRow() < 2) {
      Logger.log('ERROR: No classifications found. Run Pass 2A first.');
      SpreadsheetApp.getUi().alert('No classification data found. Run Pass 2A (Classify) first.');
      return;
    }

    const classData = classSheet.getDataRange().getValues();

    // Read inventory for folder data
    const invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    const invData = invSheet.getDataRange().getValues();

    const existingFolders = [];
    for (let i = 3; i < invData.length; i++) {
      if (invData[i][INV.IS_FOLDER] === 'YES') {
        existingFolders.push({
          id: invData[i][INV.ID],
          name: invData[i][INV.NAME],
          folderPath: invData[i][INV.PATH],
          childFileCount: invData[i][INV.CHILD_COUNT]
        });
      }
    }

    // Parse classifications into structured objects (CLS indices defined globally)
    const classifications = [];
    for (let i = 3; i < classData.length; i++) {  // skip title + header + description row
      const row = classData[i];
      if (!row[CLS.NAME]) continue; // skip empty rows
      classifications.push({
        file: {
          id: row[CLS.ID],
          name: row[CLS.NAME],
          mimeType: row[CLS.MIME],
          parentFolder: row[CLS.PARENT],
          folderPath: row[CLS.PATH],
          lastModified: new Date(row[CLS.MODIFIED])
        },
        pillar: row[CLS.PILLAR],
        subCategory: row[CLS.SUBCAT],
        confidence: row[CLS.CONFIDENCE],
        note: row[CLS.NOTE],
        ageFlag: row[CLS.AGE_FLAG] === 'YES',
        entity: row[CLS.ENTITY] || null,
        year: row[CLS.YEAR] || null,
        targetPath: row[CLS.TARGET_PATH] || null
      });
    }

    Logger.log(`Loaded ${classifications.length} classifications, ${existingFolders.length} folders\n`);

    // Step 1: Match pillar anchors
    Logger.log('--- Step 1: Matching pillar anchors ---');
    const rootFolder = DriveApp.getFolderById(getRootFolderId_());
    const pillarActions = matchPillarAnchors(rootFolder, existingFolders);
    Logger.log(`Pillar actions: ${pillarActions.length}\n`);

    // Step 2: Folder-level moves (from FOLDER_CLASSIFICATIONS, if run)
    Logger.log('--- Step 2: Building folder move actions ---');
    const intactFolders = readIntactFolderMoves_();
    const folderMoveActions = [];
    for (const f of intactFolders) {
      if (!f.targetPath || f.targetPath === '0_NEEDS_REVIEW') continue;
      folderMoveActions.push({
        action: 'MOVE_FOLDER',
        targetId: f.id,
        currentName: f.name,
        destination: f.targetPath,
        parent: f.targetPath.split('/')[0],
        reason: `Coherent folder moves intact (${f.confidence}% confidence)${f.note ? ' | ' + f.note : ''}`,
        fileCount: f.fileCount,
        confidence: f.confidence
      });
    }
    Logger.log(`Folder move actions: ${folderMoveActions.length}\n`);

    // Step 3: Build sub-folder plan
    Logger.log('--- Step 3: Clustering and planning sub-folders ---');
    const subfolderPlan = buildSubfolderPlan(classifications, existingFolders, threshold);
    Logger.log(`Sub-folder actions: ${subfolderPlan.length}\n`);

    // Step 4: Build file move plan
    Logger.log('--- Step 4: Planning file moves ---');
    const movePlan = buildMovePlan(classifications, subfolderPlan, threshold);
    Logger.log(`File move actions: ${movePlan.length}\n`);

    // Write the visual plan sheet — folder moves and individual files as separate sections
    const allActions = [...folderMoveActions, ...pillarActions, ...subfolderPlan, ...movePlan];
    writePlanSheet(ss, allActions);

    Logger.log(`\n=== PLAN COMPLETE ===`);
    Logger.log(`Total proposed actions: ${allActions.length}`);
    Logger.log('Review the ORGANIZATION_PLAN sheet.');
    Logger.log('All rows default to APPROVED. Delete or reject rows you do NOT want.');
    Logger.log('Then run Pass 3 Execute.');

    SpreadsheetApp.getUi().alert(
      'Plan Complete',
      `Organization plan built with ${allActions.length} actions.\n\nReview the ORGANIZATION_PLAN sheet, then run Pass 3.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in pass2bBuildPlan: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Matches existing root-level folders to pillar anchors.
 * Returns RENAME actions for folders that exist but have non-standard names,
 * and CREATE actions for missing pillar anchors.
 */
function matchPillarAnchors(rootFolder, existingFolders) {
  const actions = [];

  for (const [pillarKey, spec] of Object.entries(PILLAR_ANCHORS)) {
    const targetName = applyNamingConvention(pillarKey);

    // Query the LIVE Drive for this folder (three-tier flexible matching)
    const liveFolder = findFolderInChildren(rootFolder, pillarKey);

    if (liveFolder) {
      const currentName = liveFolder.getName();
      if (currentName !== targetName) {
        actions.push({
          action: 'RENAME_FOLDER',
          targetId: liveFolder.getId(),
          currentName: currentName,
          newName: targetName,
          parent: 'ROOT',
          reason: `Standardize pillar anchor name`
        });
      }
      // else: already correctly named, no action needed
    } else {
      // Also try matching by the formatted target name directly
      const liveFolderByTarget = findFolderInChildren(rootFolder, targetName);
      if (liveFolderByTarget) {
        const currentName = liveFolderByTarget.getName();
        if (currentName !== targetName) {
          actions.push({
            action: 'RENAME_FOLDER',
            targetId: liveFolderByTarget.getId(),
            currentName: currentName,
            newName: targetName,
            parent: 'ROOT',
            reason: `Standardize pillar anchor name`
          });
        }
      } else {
        // Pillar folder truly doesn't exist
        actions.push({
          action: 'CREATE_FOLDER',
          targetId: '',
          currentName: '(new)',
          newName: targetName,
          parent: 'ROOT',
          reason: `Missing pillar anchor`
        });
      }
    }
  }

  return actions;
}

/**
 * Classifies all files using Claude API.
 * Delegates to classifyBatch() so there is one source of truth for the prompt.
 * Returns an array of { file, pillar, subCategory, ageFlag, confidence }
 */
function classifyAllFiles(files, ageCutoff) {
  const classifications = [];

  const pillarDesc = {};
  for (const [key, spec] of Object.entries(PILLAR_ANCHORS)) {
    pillarDesc[key] = spec.description;
  }

  const batchSize = 10;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const rows = classifyBatch(batch, pillarDesc, ageCutoff);

    // Convert sheet rows back to classification objects
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const file = batch[r] || batch[0];
      classifications.push({
        file: file,
        pillar: row[6],
        subCategory: row[7],
        confidence: row[8],
        note: row[9],
        ageFlag: row[10] === 'YES'
      });
    }

    if ((i + batchSize) % 50 === 0 || i + batchSize >= files.length) {
      Logger.log(`Classified ${Math.min(i + batchSize, files.length)} / ${files.length} files`);
    }

    Utilities.sleep(500);
  }

  return classifications;
}

/**
 * Builds the sub-folder plan by clustering classifications and checking threshold.
 * Prefers renaming existing folders over creating new ones.
 * Proposes consolidation when multiple small folders share a theme.
 */
function buildSubfolderPlan(classifications, existingFolders, threshold) {
  const actions = [];

  // Group classifications by pillar, then by sub-category
  const pillarGroups = {};
  for (const c of classifications) {
    if (c.pillar === '0_NEEDS_REVIEW' || c.pillar === '00_PENDING_DELETION') continue;

    if (!pillarGroups[c.pillar]) pillarGroups[c.pillar] = {};
    if (!pillarGroups[c.pillar][c.subCategory]) pillarGroups[c.pillar][c.subCategory] = [];
    pillarGroups[c.pillar][c.subCategory].push(c);
  }

  for (const [pillar, categories] of Object.entries(pillarGroups)) {
    // Get existing sub-folders for this pillar
    const pillarFolders = existingFolders.filter(f => {
      return f.folderPath && f.folderPath.includes(pillar.replace(/_/g, ''));
    });

    for (const [subCat, items] of Object.entries(categories)) {
      if (items.length < threshold) {
        // Below threshold: files stay in parent pillar, no sub-folder action
        Logger.log(`  ${pillar}/${subCat}: ${items.length} files (below threshold of ${threshold}, stays in pillar)`);
        continue;
      }

      // Above threshold: check if an existing folder already serves this purpose
      const targetName = applyNamingConvention(subCat);
      let matchedFolder = null;

      for (const existing of pillarFolders) {
        if (flexMatch(existing.name, subCat) || flexMatch(existing.name, targetName)) {
          matchedFolder = existing;
          break;
        }
      }

      // Also check if files are already mostly in the same existing folder
      const currentFolders = {};
      for (const item of items) {
        const folder = item.file.parentFolder;
        currentFolders[folder] = (currentFolders[folder] || 0) + 1;
      }

      // Find the most common current folder for these files
      let dominantFolder = null;
      let dominantCount = 0;
      for (const [folder, count] of Object.entries(currentFolders)) {
        if (count > dominantCount) {
          dominantFolder = folder;
          dominantCount = count;
        }
      }

      if (matchedFolder) {
        // Folder exists and matches: rename if needed
        if (matchedFolder.name !== targetName) {
          actions.push({
            action: 'RENAME_FOLDER',
            targetId: matchedFolder.id,
            currentName: matchedFolder.name,
            newName: targetName,
            parent: pillar,
            reason: `${items.length} files match this category`,
            fileCount: items.length
          });
        }
      } else if (dominantFolder && dominantCount >= Math.floor(items.length * 0.6)) {
        // 60%+ of files are already in the same folder - rename that folder instead of creating
        const existingMatch = existingFolders.find(f => f.name === dominantFolder);
        if (existingMatch && existingMatch.name !== targetName) {
          actions.push({
            action: 'RENAME_FOLDER',
            targetId: existingMatch.id,
            currentName: existingMatch.name,
            newName: targetName,
            parent: pillar,
            reason: `${dominantCount}/${items.length} files already here. Rename to standardize.`,
            fileCount: items.length
          });
        }
      } else {
        // No good existing folder found: create new sub-folder
        actions.push({
          action: 'CREATE_SUBFOLDER',
          targetId: '',
          currentName: '(new)',
          newName: targetName,
          parent: pillar,
          reason: `${items.length} files need this category (no existing match)`,
          fileCount: items.length
        });
      }
    }

    // Check for consolidation opportunities: existing sub-folders with < threshold files
    // that could be merged into a parent or sibling
    for (const existing of pillarFolders) {
      if (existing.childFileCount > 0 && existing.childFileCount < threshold) {
        // Small folder - flag for potential consolidation
        const hasMatch = Object.keys(categories).some(cat =>
          flexMatch(existing.name, cat) || flexMatch(existing.name, applyNamingConvention(cat))
        );

        if (!hasMatch) {
          actions.push({
            action: 'FLAG_CONSOLIDATE',
            targetId: existing.id,
            currentName: existing.name,
            newName: '',
            parent: pillar,
            reason: `Only ${existing.childFileCount} files. Consider merging into parent pillar.`,
            fileCount: existing.childFileCount
          });
        }
      }
    }
  }

  return actions;
}

/**
 * Builds the file move plan based on classifications and the sub-folder plan.
 * Only moves files that are not already in their target location.
 */
function buildMovePlan(classifications, subfolderPlan, threshold) {
  const actions = [];

  // Build a map of which sub-categories earned their own folder
  const earnedFolders = {};
  for (const action of subfolderPlan) {
    if (action.action === 'CREATE_SUBFOLDER' || action.action === 'RENAME_FOLDER') {
      const key = `${action.parent}/${action.newName}`;
      earnedFolders[key] = action.newName;
    }
  }

  // Track which deep folders need to be created
  const foldersToCreate = {};

  for (const c of classifications) {
    const file = c.file;

    // Skip files the AI marked as already correctly placed
    if (c.note && c.note.includes('ALREADY_PLACED')) {
      continue;
    }

    // Skip files that are 2+ levels deep in any recognized pillar hierarchy.
    // These were placed intentionally (e.g., coaching photos inside a program subfolder).
    const currentPath = file.folderPath || '';
    const pathParts = currentPath.split('/').filter(p => p.length > 0);
    if (pathParts.length >= 2) {
      // Check if the file's root folder matches any known pillar
      const rootFolder = pathParts[0];
      const isInPillar = Object.keys(PILLAR_ANCHORS).some(pillarKey => {
        return flexMatch(rootFolder, pillarKey);
      });
      if (isInPillar) {
        // File is 2+ levels deep inside a real pillar — leave it alone
        continue;
      }
    }

    let targetFolder;

    if (c.pillar === '00_PENDING_DELETION') {
      targetFolder = '00_PENDING_DELETION';
    } else if (c.ageFlag && c.pillar !== '00_PENDING_DELETION') {
      targetFolder = '0_NEEDS_REVIEW';
    } else {
      // Use the full target path from classification (includes entity/year tiers)
      if (c.targetPath && c.targetPath.length > 0) {
        targetFolder = c.targetPath;
      } else {
        // Fallback to old logic if targetPath is missing (backward compat)
        const subFolderName = applyNamingConvention(c.subCategory);
        const earnedKey = `${c.pillar}/${subFolderName}`;

        if (earnedFolders[earnedKey]) {
          targetFolder = `${c.pillar}/${subFolderName}`;
        } else {
          targetFolder = c.pillar;
        }
      }
    }

    // Check if file is already in the right place
    const targetNormalized = normalizeFolderName(targetFolder);
    const currentNormalized = normalizeFolderName(currentPath);

    if (currentNormalized.includes(targetNormalized)) {
      // Already in the right place (or a sub-folder of it)
      continue;
    }

    // Track deep folders that need creation (entity/year folders)
    const targetParts = targetFolder.split('/');
    if (targetParts.length > 2) {
      // Path has more than pillar/subCategory — deeper tiers need folder creation
      let accumPath = '';
      for (let p = 0; p < targetParts.length; p++) {
        accumPath = accumPath ? accumPath + '/' + targetParts[p] : targetParts[p];
        if (p >= 2 && !foldersToCreate[accumPath]) {
          foldersToCreate[accumPath] = {
            action: 'CREATE_FOLDER',
            targetId: '',
            currentName: '',
            newName: targetParts[p],
            destination: accumPath,
            parent: targetParts.slice(0, p).join('/'),
            reason: `Auto-create for ${targetParts.length - p === 1 ? 'year' : 'entity/year'} tier sorting`,
            fileCount: 0
          };
        }
      }
    }

    actions.push({
      action: 'MOVE_FILE',
      targetId: file.id,
      currentName: file.name,
      destination: targetFolder,
      parent: c.pillar,
      reason: `Classified as ${targetFolder} (${c.confidence}% confidence)${c.note ? ' | ' + c.note : ''}`,
      fileCount: 1,
      confidence: parseInt(c.confidence, 10) || 0
    });
  }

  // Only create folders that at least one MOVE_FILE action targets
  const usedPaths = new Set(actions.map(a => a.destination));
  const folderActions = Object.values(foldersToCreate).filter(f => {
    // Keep this folder if any move destination starts with or matches its path
    return Array.from(usedPaths).some(dest => dest === f.destination || dest.startsWith(f.destination + '/'));
  });

  return [...folderActions, ...actions];
}


// ============================================================================
// SECTION 4: PASS 3 - EXECUTE STRUCTURE CHANGES
// ============================================================================

/**
 * PASS 3 EXECUTE: Reads the ORGANIZATION_PLAN sheet and executes all APPROVED rows.
 * Handles: RENAME_FOLDER, CREATE_FOLDER, CREATE_SUBFOLDER, MOVE_FILE, FLAG_CONSOLIDATE
 */
function pass3Execute() {
  const startTime = Date.now();
  try {
    Logger.log('=== PASS 3 EXECUTE: STRUCTURE CHANGES ===\n');

    const ss = SpreadsheetApp.getActive();
    const planSheet = ss.getSheetByName(ORG_PLAN_SHEET_NAME);

    if (!planSheet || planSheet.getLastRow() < 2) {
      Logger.log('ERROR: No organization plan found. Run Pass 2 first.');
      SpreadsheetApp.getUi().alert('No organization plan found. Run Pass 2 first.');
      return;
    }

    const data = planSheet.getDataRange().getValues();
    const rootFolder = DriveApp.getFolderById(getRootFolderId_());

    // One run ID per logical execution (survives auto-resume) — powers Undo Last Run
    const runId = getRunId_('PASS3_RUN_ID');

    // Valid action types (used to skip summary rows and pillar headers)
    const validActions = ['MOVE_FOLDER', 'RENAME_FOLDER', 'CREATE_FOLDER', 'CREATE_SUBFOLDER', 'MOVE_FILE', 'FLAG_CONSOLIDATE', 'FLAG_REVIEW'];

    let renamedCount = 0;
    let createdCount = 0;
    let movedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 1; i < data.length; i++) {
      // Time check — auto-resume if approaching the 6-minute limit
      if (Date.now() - startTime > MAX_RUN_MS) {
        clearPass3Triggers_();
        ScriptApp.newTrigger('pass3Execute')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at row ${i}/${data.length}. Auto-resuming in ~1 minute.`);
        Logger.log(`Progress so far — Renamed: ${renamedCount}, Created: ${createdCount}, Moved: ${movedCount}, Errors: ${errorCount}`);
        return;
      }

      const action = (data[i][0] || '').toString().trim();

      // Skip non-action rows (summary block, pillar headers, spacers)
      if (!validActions.includes(action)) continue;

      const targetId = data[i][1];
      const currentName = data[i][2];
      const newNameOrDest = data[i][3];
      const parent = data[i][4];
      const status = (data[i][7] || '').toString().toUpperCase().trim();

      // Skip rows already processed (DONE, ERROR, REVIEWED) or REJECTED
      if (status === 'DONE' || status === 'ERROR' || status === 'REVIEWED') continue;
      if (status === 'REJECTED') { skippedCount++; continue; }

      // Redirect to triage folders if status was changed to a folder destination
      if (status === '0_NEEDS_REVIEW' || status === '00_PENDING_DELETION') {
        if (action === 'MOVE_FILE' && targetId) {
          try {
            const triageFile = DriveApp.getFileById(targetId);
            const triageParents = triageFile.getParents();
            const triageFromId = triageParents.hasNext() ? triageParents.next().getId() : getRootFolderId_();
            const triageFolder = ensureFolderPath(status);
            triageFile.moveTo(triageFolder);
            movedCount++;
            addMoveLog_(runId, 'MOVE_FILE', currentName, targetId, triageFromId, status, '', '');
            Logger.log(`TRIAGED: "${currentName}" → ${status}`);
            planSheet.getRange(i + 1, 8).setValue('DONE');
          } catch (triageErr) {
            Logger.log(`ERROR triaging ${currentName}: ${triageErr.message}`);
            errorCount++;
          }
        }
        continue;
      }

      // Only APPROVED rows proceed past this point
      if (status !== 'APPROVED') continue;

      try {
        switch (action) {
          case 'RENAME_FOLDER': {
            const folder = DriveApp.getFolderById(targetId);
            const oldName = folder.getName();
            folder.setName(newNameOrDest);
            renamedCount++;
            addMoveLog_(runId, 'RENAME_FOLDER', newNameOrDest, targetId, '', '', oldName, newNameOrDest);
            Logger.log(`RENAMED: "${oldName}" → "${newNameOrDest}"`);
            planSheet.getRange(i + 1, 8).setValue('DONE');
            break;
          }

          case 'CREATE_FOLDER':
          case 'CREATE_SUBFOLDER': {
            // Find parent folder
            let parentFolderObj;
            if (parent === 'ROOT') {
              parentFolderObj = rootFolder;
            } else {
              parentFolderObj = findFolderByPath(parent);
            }

            if (parentFolderObj) {
              // Double-check it doesn't already exist
              const existing = findFolderInChildren(parentFolderObj, newNameOrDest);
              if (!existing) {
                const createdFolder = parentFolderObj.createFolder(newNameOrDest);
                createdCount++;
                addMoveLog_(runId, 'CREATE_FOLDER', newNameOrDest, createdFolder.getId(), parentFolderObj.getId(), parent + '/' + newNameOrDest, '', '');
                Logger.log(`CREATED: ${newNameOrDest} (in ${parent})`);
              } else {
                Logger.log(`SKIPPED: ${newNameOrDest} already exists in ${parent}`);
              }
            } else {
              Logger.log(`ERROR: Parent folder "${parent}" not found for ${newNameOrDest}`);
              errorCount++;
            }
            planSheet.getRange(i + 1, 8).setValue('DONE');
            break;
          }

          case 'MOVE_FILE': {
            const file = DriveApp.getFileById(targetId);
            // Try to find the destination folder, auto-creating missing tiers if needed
            let destFolder = findFolderByPath(newNameOrDest);
            if (!destFolder) {
              destFolder = ensureFolderPath(newNameOrDest);
            }

            if (destFolder) {
              // Capture origin for undo, then move
              const currentParents = file.getParents();
              const fromParentId = currentParents.hasNext() ? currentParents.next().getId() : getRootFolderId_();
              file.moveTo(destFolder);
              movedCount++;
              addMoveLog_(runId, 'MOVE_FILE', currentName, targetId, fromParentId, newNameOrDest, '', '');
              Logger.log(`MOVED: "${currentName}" → ${newNameOrDest}`);
            } else {
              Logger.log(`ERROR: Destination "${newNameOrDest}" not found for ${currentName}`);
              errorCount++;
            }
            planSheet.getRange(i + 1, 8).setValue('DONE');
            break;
          }

          case 'MOVE_FOLDER': {
            const folderObj = DriveApp.getFolderById(targetId);
            // Destination is the PARENT path the folder lands under
            let destFolder = findFolderByPath(newNameOrDest);
            if (!destFolder) {
              destFolder = ensureFolderPath(newNameOrDest);
            }

            if (destFolder) {
              const folderParents = folderObj.getParents();
              const fromParentId = folderParents.hasNext() ? folderParents.next().getId() : getRootFolderId_();
              folderObj.moveTo(destFolder);
              movedCount++;
              addMoveLog_(runId, 'MOVE_FOLDER', currentName, targetId, fromParentId, newNameOrDest, '', '');
              Logger.log(`MOVED FOLDER: "${currentName}" → ${newNameOrDest} (contents intact)`);
            } else {
              Logger.log(`ERROR: Destination "${newNameOrDest}" not found for folder ${currentName}`);
              errorCount++;
            }
            planSheet.getRange(i + 1, 8).setValue('DONE');
            break;
          }

          case 'FLAG_CONSOLIDATE': {
            // Consolidation flags are informational - user decides manually
            Logger.log(`FLAGGED: "${currentName}" - review for consolidation`);
            planSheet.getRange(i + 1, 8).setValue('REVIEWED');
            break;
          }

          default:
            Logger.log(`UNKNOWN action: ${action}`);
        }
      } catch (execError) {
        Logger.log(`ERROR on row ${i + 1}: ${execError.message}`);
        planSheet.getRange(i + 1, 8).setValue('ERROR');
        errorCount++;
      }
    }

    // All rows processed — clean up any leftover triggers and close the run
    clearPass3Triggers_();
    endRun_('PASS3_RUN_ID');

    Logger.log(`\n=== EXECUTION COMPLETE ===`);
    Logger.log(`Renamed: ${renamedCount} folders`);
    Logger.log(`Created: ${createdCount} folders`);
    Logger.log(`Moved: ${movedCount} files`);
    Logger.log(`Skipped (rejected): ${skippedCount}`);
    Logger.log(`Errors: ${errorCount}`);

    // Auto-build the handoff summary from this run's move log
    try {
      buildRunSummary();
      Logger.log('RUN_SUMMARY sheet updated — screenshot-ready for handoff.');
    } catch (summaryErr) {
      Logger.log(`Run summary skipped: ${summaryErr.message}`);
    }
  } catch (error) {
    Logger.log(`ERROR in pass3Execute: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Clears auto-resume triggers for Pass 3.
 */
function clearPass3Triggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'pass3Execute') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}


// ============================================================================
// SECTION 5: PASS 4 - FILE RENAME (Two-Mode)
// ============================================================================
//
// MODE A (Mechanical): Files with recognizable names get formatting fixes only.
//   - Uppercase, underscores, abbreviations, strip "Copy of", etc.
//   - Auto-applied (shown in dry run log, executed without approval queue).
//
// MODE B (AI-Suggested): Files with low-information names get Claude-powered
//   rename suggestions based on folder context and file content peek.
//   - Suggestions go to the RENAME_APPROVAL sheet for human review.
//   - User/VA marks rows as APPROVED or REJECTED.
//   - Run applyApprovedRenames() to execute approved rows only.
//

/**
 * PASS 4 DRY RUN - Two-mode rename scan
 */
/**
 * PASS 4 DRY RUN - Two-mode rename scan.
 * Uses the FULL_INVENTORY sheet as the file list instead of re-crawling Drive.
 * This avoids timeout on the recursive scan and enables resume by row index.
 */
function pass4RenameDryRun() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();
  loadTestMode();

  try {
    const savedIndex = parseInt(props.getProperty('RENAME_SCAN_INDEX') || '0', 10);

    const ss = SpreadsheetApp.getActive();
    const logSheet = getOrCreateLogSheet();
    const approvalSheet = getOrCreateApprovalSheet();

    if (savedIndex === 0) {
      Logger.log('=== PASS 4 DRY RUN: RENAME (TWO-MODE) ===');
      Logger.log('Mode A: Mechanical formatting fixes (auto-apply on execute)');
      Logger.log('Mode B: AI-suggested renames (require approval)\n');
      clearLogSheet(logSheet);
      addLogHeader(logSheet);
      clearApprovalSheet(approvalSheet);
    } else {
      Logger.log(`=== PASS 4 DRY RUN: RESUMING (from row ${savedIndex + 1}) ===\n`);
    }

    // Read file list from inventory instead of re-crawling Drive
    const invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    if (!invSheet || invSheet.getLastRow() < 2) {
      Logger.log('ERROR: No inventory found. Run Pass 1 first.');
      SpreadsheetApp.getUi().alert('No inventory found. Run Pass 1 first.');
      return;
    }
    const invData = invSheet.getDataRange().getValues();

    let modeACount = 0;
    let modeBCount = 0;
    let skippedCount = 0;
    let fileCount = 0;

    // Start from row 1 (skip header), resume from savedIndex
    const startRow = Math.max(savedIndex, 3);
    Logger.log(`Scanning ${invData.length - 1} inventory rows\n`);

    for (let i = startRow; i < invData.length; i++) {
      // Time check — auto-resume if approaching the 6-minute limit
      if (Date.now() - startTime > MAX_RUN_MS) {
        props.setProperty('RENAME_SCAN_INDEX', i.toString());
        clearPass4DryRunTriggers_();
        ScriptApp.newTrigger('pass4RenameDryRun')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at row ${i}/${invData.length}. Auto-resuming in ~1 minute.`);
        Logger.log(`Progress so far — Mode A: ${modeACount}, Mode B: ${modeBCount}`);
        return;
      }

      const fileId = invData[i][INV.ID];
      const originalName = invData[i][INV.NAME];
      const mimeType = invData[i][INV.MIME] || '';
      const isFolder = invData[i][INV.IS_FOLDER] === 'YES';
      const parentFolder = invData[i][INV.PARENT] || 'ROOT';

      // Skip folders (Pass 4 handles files only; folder renames are in Pass 2/3)
      if (isFolder) continue;

      // Skip folder description docs
      if (originalName.includes('FOLDER_DESCRIPTION')) {
        skippedCount++;
        continue;
      }

      fileCount++;

      // Test mode cap
      if (TEST_MODE && fileCount >= TEST_MODE_LIMIT) {
        Logger.log(`\nTEST MODE: Stopped after ${fileCount} files (limit: ${TEST_MODE_LIMIT})`);
        break;
      }

      // Determine which mode
      if (isLowInformationName(originalName)) {
        // MODE B: AI-suggested rename — need the actual file object for content peek
        try {
          const file = DriveApp.getFileById(fileId);
          const suggestion = suggestFileName(file, originalName, mimeType, parentFolder);

          if (suggestion && suggestion !== originalName) {
            addApprovalRow(approvalSheet, fileId, originalName, suggestion, parentFolder, mimeType);
            modeBCount++;
            Logger.log(`MODE B: "${originalName}" → SUGGESTED: "${suggestion}" (needs approval)`);
          }
        } catch (fileErr) {
          Logger.log(`SKIP: Could not access file "${originalName}" (${fileId}): ${fileErr.message}`);
        }
      } else {
        // MODE A: Mechanical rename
        const newName = generateFileName(originalName, mimeType);

        if (newName !== originalName) {
          const action = {
            type: 'RENAME_FILE',
            currentName: originalName,
            newName: newName,
            parentFolder: parentFolder,
            status: 'PROPOSED'
          };
          addLogRow(logSheet, action);
          modeACount++;
          Logger.log(`MODE A: "${originalName}" → "${newName}"`);
        }
      }

      if (fileCount % 50 === 0) {
        Logger.log(`Processed ${fileCount} files (row ${i}/${invData.length})...`);
      }
    }

    // All rows processed — clean up
    props.deleteProperty('RENAME_SCAN_INDEX');
    clearPass4DryRunTriggers_();

    Logger.log(`\nTotal files scanned: ${fileCount}`);
    Logger.log(`Skipped (system files): ${skippedCount}`);
    Logger.log(`Mode A (mechanical renames): ${modeACount}`);
    Logger.log(`Mode B (AI suggestions, needs approval): ${modeBCount}`);
    Logger.log('\nDRY RUN COMPLETE');
    Logger.log('- Review log sheet for Mode A renames, then run pass4RenameExecute()');
    Logger.log('- Review RENAME_APPROVAL sheet for Mode B suggestions');
  } catch (error) {
    Logger.log(`ERROR in pass4RenameDryRun: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Clears auto-resume triggers for Pass 4 Dry Run.
 */
function clearPass4DryRunTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'pass4RenameDryRun') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * RESET: Clears all Pass 4 resume state and triggers.
 * Run this before re-running Pass 4 if a previous run failed or you pasted new code.
 */
function resetPass4() {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty('RENAME_SCAN_INDEX');
  props.deleteProperty('RENAME_EXEC_INDEX');
  props.deleteProperty('APPLY_RENAME_INDEX');
  clearPass4DryRunTriggers_();
  clearPass4ExecTriggers_();
  clearApplyRenamesTriggers_();
  Logger.log('Pass 4 state cleared. You can now re-run pass4RenameDryRun().');
}

/**
 * PASS 4 EXECUTE - Applies Mode A (mechanical) renames only.
 * Uses FULL_INVENTORY sheet as file list to avoid recursive scan timeout.
 */
function pass4RenameExecute() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();
  loadTestMode();

  try {
    const savedIndex = parseInt(props.getProperty('RENAME_EXEC_INDEX') || '0', 10);

    const ss = SpreadsheetApp.getActive();
    const invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    if (!invSheet || invSheet.getLastRow() < 2) {
      Logger.log('ERROR: No inventory found. Run Pass 1 first.');
      return;
    }
    const invData = invSheet.getDataRange().getValues();

    let renamedCount = 0;
    let skippedLowInfo = 0;
    let errorCount = 0;

    if (savedIndex === 0) {
      Logger.log('=== PASS 4 EXECUTE: RENAME (MODE A ONLY) ===\n');
    } else {
      Logger.log(`=== PASS 4 EXECUTE: RESUMING (from row ${savedIndex + 1}) ===\n`);
    }

    const startRow = Math.max(savedIndex, 3);
    Logger.log(`Processing ${invData.length - 1} inventory rows\n`);

    for (let i = startRow; i < invData.length; i++) {
      // Time check — auto-resume if approaching the 6-minute limit
      if (Date.now() - startTime > MAX_RUN_MS) {
        props.setProperty('RENAME_EXEC_INDEX', i.toString());
        clearPass4ExecTriggers_();
        ScriptApp.newTrigger('pass4RenameExecute')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at row ${i}/${invData.length}. Auto-resuming in ~1 minute.`);
        Logger.log(`Progress so far — Renamed: ${renamedCount}, Errors: ${errorCount}`);
        return;
      }

      // Test mode cap
      if (TEST_MODE && (i - startRow) >= TEST_MODE_LIMIT) {
        Logger.log(`\nTEST MODE: Stopped after ${i - startRow} rows (limit: ${TEST_MODE_LIMIT})`);
        break;
      }

      const fileId = invData[i][INV.ID];
      const originalName = invData[i][INV.NAME];
      const mimeType = invData[i][INV.MIME] || '';
      const isFolder = invData[i][INV.IS_FOLDER] === 'YES';

      // Skip folders
      if (isFolder) continue;
      if (originalName.includes('FOLDER_DESCRIPTION')) continue;

      if (isLowInformationName(originalName)) {
        skippedLowInfo++;
        continue;
      }

      const newName = generateFileName(originalName, mimeType);

      if (newName !== originalName) {
        try {
          const file = DriveApp.getFileById(fileId);
          file.setName(newName);
          renamedCount++;
          addMoveLog_(getRunId_('PASS4_RUN_ID'), 'RENAME_FILE', newName, fileId, '', '', originalName, newName);
          Logger.log(`RENAMED: "${originalName}" → "${newName}"`);
        } catch (renameError) {
          Logger.log(`ERROR renaming ${originalName}: ${renameError.message}`);
          errorCount++;
        }
      }
    }

    // All rows processed — clean up
    props.deleteProperty('RENAME_EXEC_INDEX');
    clearPass4ExecTriggers_();
    endRun_('PASS4_RUN_ID');

    Logger.log(`\nRenamed (Mode A): ${renamedCount} files`);
    Logger.log(`Skipped for approval (Mode B): ${skippedLowInfo} files`);
    Logger.log(`Errors: ${errorCount}`);
    Logger.log('PASS 4 EXECUTE COMPLETE');
  } catch (error) {
    Logger.log(`ERROR in pass4RenameExecute: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Clears auto-resume triggers for Pass 4 Execute.
 */
function clearPass4ExecTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'pass4RenameExecute') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * Applies approved renames from the RENAME_APPROVAL sheet.
 * Only processes rows where Status = "APPROVED".
 */
function applyApprovedRenames() {
  const startTime = Date.now();
  try {
    Logger.log('=== APPLYING APPROVED RENAMES ===\n');

    const ss = SpreadsheetApp.getActive();
    const sheet = ss.getSheetByName(RENAME_APPROVAL_SHEET);

    if (!sheet) {
      Logger.log('No RENAME_APPROVAL sheet found. Run pass4RenameDryRun() first.');
      return;
    }

    const data = sheet.getDataRange().getValues();
    let approvedCount = 0;
    let rejectedCount = 0;
    let errorCount = 0;

    // Column order: Current Name (0), Suggested Name (1), Status (2), Folder (3), File Type (4), File ID (5)
    // Skip title (0), header (1), description (2) — data starts at index 3
    for (let i = 3; i < data.length; i++) {
      // Time check — auto-resume if approaching the 6-minute limit
      if (Date.now() - startTime > MAX_RUN_MS) {
        clearApplyRenamesTriggers_();
        ScriptApp.newTrigger('applyApprovedRenames')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at row ${i}/${data.length}. Auto-resuming in ~1 minute.`);
        Logger.log(`Progress so far — Applied: ${approvedCount}, Errors: ${errorCount}`);
        return;
      }

      const currentName = data[i][0];
      const suggestedName = data[i][1];
      const status = (data[i][2] || '').toString().toUpperCase().trim();
      const fileId = data[i][5];

      // Skip already-processed rows
      if (status === 'APPLIED' || status === 'SKIPPED' || status === 'ERROR') continue;

      if (status === 'APPROVED') {
        try {
          const file = DriveApp.getFileById(fileId);
          file.setName(suggestedName);
          approvedCount++;
          addMoveLog_(getRunId_('MODEB_RUN_ID'), 'RENAME_FILE', suggestedName, fileId, '', '', currentName, suggestedName);
          Logger.log(`RENAMED: "${currentName}" → "${suggestedName}"`);
          sheet.getRange(i + 1, 3).setValue('APPLIED');
        } catch (err) {
          Logger.log(`ERROR renaming file ID ${fileId}: ${err.message}`);
          sheet.getRange(i + 1, 3).setValue('ERROR');
          errorCount++;
        }
      } else if (status === 'REJECTED') {
        rejectedCount++;
        sheet.getRange(i + 1, 3).setValue('SKIPPED');
      }
    }

    // All rows processed — clean up
    clearApplyRenamesTriggers_();
    endRun_('MODEB_RUN_ID');

    Logger.log(`\nApproved and renamed: ${approvedCount}`);
    Logger.log(`Rejected and skipped: ${rejectedCount}`);
    Logger.log(`Errors: ${errorCount}`);
  } catch (error) {
    Logger.log(`ERROR in applyApprovedRenames: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Clears auto-resume triggers for Apply Approved Renames.
 */
function clearApplyRenamesTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'applyApprovedRenames') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}


// ============================================================================
// SECTION 6: NAME PROCESSING FUNCTIONS
// ============================================================================

/**
 * Detects whether a file name is "low-information" and needs AI-assisted renaming.
 */
function isLowInformationName(fileName) {
  const lastDot = fileName.lastIndexOf('.');
  const name = lastDot > 0 ? fileName.substring(0, lastDot) : fileName;

  const genericPatterns = [
    /^untitled/i,
    /^document\s?\d*$/i,
    /^sheet\s?\d*$/i,
    /^presentation\s?\d*$/i,
    /^image\s?\d*$/i,
    /^img[_\-]?\d+$/i,
    /^dsc[_\-]?\d+$/i,
    /^screenshot/i,
    /^screen\s?shot/i,
    /^copy\s+of\s+/i,
    /^new\s+doc/i
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(name)) return true;
  }

  const cleanName = name.replace(/[_\-\s\d.()]/g, '');
  if (cleanName.length > 0 && cleanName.length < LOW_INFO_NAME_THRESHOLD) {
    const words = name.replace(/[_\-]/g, ' ').split(/\s+/);
    const realWords = words.filter(w => {
      const cleaned = w.replace(/\d/g, '');
      return cleaned.length >= 3;
    });
    if (realWords.length === 0) return true;
  }

  const vowelCount = (cleanName.match(/[aeiou]/gi) || []).length;
  if (cleanName.length > 3 && vowelCount === 0) return true;

  return false;
}

/**
 * Uses Claude to suggest a meaningful file name.
 */
function suggestFileName(file, originalName, mimeType, parentFolderName) {
  let contentPeek = '';

  try {
    if (mimeType === 'application/vnd.google-apps.document') {
      const doc = DocumentApp.openById(file.getId());
      contentPeek = doc.getBody().getText().substring(0, 500);
    } else if (mimeType === 'application/vnd.google-apps.spreadsheet') {
      const ss = SpreadsheetApp.openById(file.getId());
      const firstSheet = ss.getSheets()[0];
      const range = firstSheet.getRange(1, 1, Math.min(5, firstSheet.getLastRow()), Math.min(5, firstSheet.getLastColumn()));
      contentPeek = range.getValues().map(row => row.join(' | ')).join('\n');
    } else if (mimeType === 'application/vnd.google-apps.presentation') {
      const pres = SlidesApp.openById(file.getId());
      const slides = pres.getSlides();
      if (slides.length > 0) {
        const shapes = slides[0].getShapes();
        contentPeek = shapes.map(s => {
          try { return s.getText().asString(); } catch(e) { return ''; }
        }).filter(t => t.length > 0).join(' | ').substring(0, 500);
      }
    }
  } catch (peekError) {
    contentPeek = '(content not accessible)';
  }

  const prompt = `You are a filing system expert. A file has a vague or meaningless name and needs a proper descriptive name.

NAMING CONVENTION:
- ALL_CAPS with underscores between words
- Apply these abbreviations: ${JSON.stringify(ABBREVIATIONS)}
- Keep it concise but descriptive (3-6 words max)
- Include the file extension if the original has one

FILE DETAILS:
- Current Name: ${originalName}
- File Type: ${mimeType}
- Located In: ${parentFolderName}
- Content Preview: ${contentPeek || '(no preview available)'}

Return ONLY the suggested file name, nothing else.

RESPONSE:`;

  const result = callClaudeAPI(prompt, 100);
  return result ? result.trim() : originalName;
}

/**
 * Generates a formatted file name applying mechanical naming convention (Mode A).
 */
function generateFileName(originalName, mimeType) {
  const lastDot = originalName.lastIndexOf('.');
  let name = originalName;
  let extension = '';

  if (lastDot > 0) {
    name = originalName.substring(0, lastDot);
    extension = originalName.substring(lastDot);
  }

  let formatted = name.toUpperCase();
  formatted = formatted.replace(/^COPY\s+OF\s+/i, '');

  // Remove standalone dashes used as separators (" - " → single space)
  formatted = formatted.replace(/\s+[-–—]+\s+/g, ' ');

  // Remove periods used as abbreviation markers (SEP., OCT., INC.) or word separators (265.STRESS.COPING)
  // Preserve periods that are part of the file extension (handled separately) and decimal numbers (e.g., 3.5)
  formatted = formatted.replace(/(\D)\.(\D)/g, '$1 $2');   // letter.letter → letter space letter
  formatted = formatted.replace(/(\D)\./g, '$1 ');          // letter. at end of word → letter space
  formatted = formatted.replace(/\.(\D)/g, ' $1');          // .letter at start of word → space letter

  // Consolidate redundant year-month ranges like "2025-JAN 2025- FEB 2026" → "2025_JAN-FEB"
  // Pattern: YYYY-Mon YYYY-Mon or YYYY Mon YYYY Mon
  formatted = formatted.replace(/(\d{4})[\s\-]*([A-Z]{3})\s+\d{4}[\s\-]*([A-Z]{3})\s+(\d{4})/g, '$4_$2-$3');
  formatted = formatted.replace(/(\d{4})[\s\-]*([A-Z]{3})\s+\d{4}[\s\-]*([A-Z]{3})/g, '$1_$2-$3');

  // Extract and preserve bracket/parenthesis content before underscore conversion
  const bracketParts = [];
  formatted = formatted.replace(/\(([^)]+)\)/g, (match, inner) => {
    const cleaned = inner.trim().replace(/\s+/g, ' ');
    const placeholder = `XBRK${bracketParts.length}X`;
    bracketParts.push(`(${cleaned})`);
    return ` ${placeholder} `;
  });
  formatted = formatted.replace(/\[([^\]]+)\]/g, (match, inner) => {
    const cleaned = inner.trim().replace(/\s+/g, ' ');
    const placeholder = `XBRK${bracketParts.length}X`;
    bracketParts.push(`[${cleaned}]`);
    return ` ${placeholder} `;
  });

  // Apply abbreviations
  for (const [full, abbr] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    formatted = formatted.replace(regex, abbr);
  }

  // Convert spaces to underscores (bracket content is protected)
  formatted = formatted.replace(/\s+/g, '_');
  formatted = formatted.replace(/_+/g, '_');
  formatted = formatted.replace(/_COPY$/i, '');
  formatted = formatted.replace(/_\(\d+\)$/i, '');
  formatted = formatted.replace(/^_+|_+$/g, '');

  // Restore bracket content (spaces preserved inside)
  for (let b = 0; b < bracketParts.length; b++) {
    formatted = formatted.replace(`_XBRK${b}X_`, `_${bracketParts[b]}`);
    formatted = formatted.replace(`_XBRK${b}X`, `_${bracketParts[b]}`);
    formatted = formatted.replace(`XBRK${b}X_`, `${bracketParts[b]}_`);
    formatted = formatted.replace(`XBRK${b}X`, bracketParts[b]);
  }

  return formatted + extension;
}


// ============================================================================
// SECTION 7: FOLDER MATCHING & NAMING UTILITIES
// ============================================================================

/**
 * Normalizes a folder name for flexible comparison.
 * Strips all separators (spaces, underscores, hyphens, dots) and uppercases.
 */
function normalizeFolderName(name) {
  return name.toUpperCase().replace(/[\s_\-\.]+/g, '');
}

/**
 * Strips the leading number prefix from a folder name.
 */
function stripNumberPrefix(name) {
  return name.replace(/^[\d]+[\.\d]*[\s_\-]*/g, '');
}

/**
 * Flexible match: returns true if two names refer to the same folder.
 * Tries exact, normalized, and core-word matching.
 */
function flexMatch(nameA, nameB) {
  if (nameA.toUpperCase() === nameB.toUpperCase()) return true;
  if (normalizeFolderName(nameA) === normalizeFolderName(nameB)) return true;

  const coreA = normalizeFolderName(stripNumberPrefix(nameA));
  const coreB = normalizeFolderName(stripNumberPrefix(nameB));
  if (coreA.length >= 3 && coreB.length >= 3 && coreA === coreB) return true;

  return false;
}

/**
 * Finds a folder by name within a parent folder's immediate children.
 * Uses flexible three-pass matching.
 */
function findFolderInChildren(parentFolder, name) {
  const folders = parentFolder.getFolders();
  const searchExact = name.toUpperCase();
  const searchNormalized = normalizeFolderName(name);
  const searchCore = normalizeFolderName(stripNumberPrefix(name));

  let normalizedMatch = null;
  let coreMatch = null;

  while (folders.hasNext()) {
    const folder = folders.next();
    const folderName = folder.getName();
    const folderExact = folderName.toUpperCase();

    if (folderExact === searchExact) return folder;

    if (!normalizedMatch && normalizeFolderName(folderName) === searchNormalized) {
      normalizedMatch = folder;
    }

    if (!coreMatch && searchCore.length >= 3) {
      const folderCore = normalizeFolderName(stripNumberPrefix(folderName));
      if (folderCore === searchCore && folderCore.length >= 3) {
        coreMatch = folder;
      }
    }
  }

  return normalizedMatch || coreMatch || null;
}

/**
 * Applies naming convention: ALL_CAPS, underscores, abbreviations.
 */
function applyNamingConvention(name) {
  let formatted = name.toUpperCase();

  for (const [full, abbr] of Object.entries(ABBREVIATIONS)) {
    const regex = new RegExp(`\\b${full}\\b`, 'gi');
    formatted = formatted.replace(regex, abbr);
  }

  formatted = formatted.replace(/\s+/g, '_');
  formatted = formatted.replace(/_+/g, '_');

  return formatted;
}

/**
 * Finds a folder by its path (e.g., "4.9_FINANCIALS/TAX_RECORDS").
 */
function findFolderByPath(path) {
  const rootFolder = DriveApp.getFolderById(getRootFolderId_());
  const pathParts = path.split('/');

  let currentFolder = rootFolder;

  for (const part of pathParts) {
    const found = findFolderInChildren(currentFolder, part);
    if (!found) return null;
    currentFolder = found;
  }

  return currentFolder;
}

/**
 * Walks a folder path and creates any missing segments.
 * Used by MOVE_FILE when deep tier folders (entity/year) don't exist yet.
 * Returns the final (deepest) folder object, or null on failure.
 */
function ensureFolderPath(path) {
  const rootFolder = DriveApp.getFolderById(getRootFolderId_());
  const pathParts = path.split('/');

  let currentFolder = rootFolder;

  for (const part of pathParts) {
    let found = findFolderInChildren(currentFolder, part);
    if (!found) {
      // Create the missing folder
      found = currentFolder.createFolder(part);
      Logger.log(`AUTO-CREATED folder: "${part}" inside "${currentFolder.getName()}"`);
    }
    currentFolder = found;
  }

  return currentFolder;
}

/**
 * Gets all files recursively from a folder and its subfolders.
 */
function getAllFilesRecursive(folder) {
  const files = [];
  const fileIterator = folder.getFiles();

  while (fileIterator.hasNext()) {
    files.push(fileIterator.next());
  }

  const folderIterator = folder.getFolders();
  while (folderIterator.hasNext()) {
    files.push(...getAllFilesRecursive(folderIterator.next()));
  }

  return files;
}


// ============================================================================
// SECTION 8: CLAUDE API
// ============================================================================

/**
 * Makes an API call to Claude.
 * @param {string} prompt - The prompt
 * @param {number} maxTokens - Max response tokens (default 100)
 * @returns {string} Response text
 */
function callClaudeAPI(prompt, maxTokens) {
  const apiKey = getApiKey_();
  if (!apiKey || apiKey === 'YOUR_CLAUDE_API_KEY_HERE') {
    Logger.log('WARNING: Claude API key not configured. Use menu "Setup: Set API Key".');
    return null;
  }

  const MAX_RETRIES = 4;
  const payload = {
    model: CLAUDE_MODEL,
    max_tokens: maxTokens || 100,
    messages: [{ role: 'user', content: prompt }]
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', options);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();

      // Rate limit (429) or overloaded (529) — wait and retry
      if (responseCode === 429 || responseCode === 529) {
        const waitSec = Math.pow(2, attempt + 1) + Math.random() * 2; // 2s, 4s, 8s, 16s + jitter
        Logger.log(`API ${responseCode} on attempt ${attempt + 1}/${MAX_RETRIES}. Waiting ${waitSec.toFixed(1)}s...`);
        Utilities.sleep(waitSec * 1000);
        continue;
      }

      if (responseCode !== 200) {
        Logger.log(`API HTTP ${responseCode}: ${responseText.substring(0, 500)}`);
        return null;
      }

      const result = JSON.parse(responseText);

      if (result.content && result.content.length > 0) {
        return result.content[0].text;
      }

      Logger.log('API returned 200 but no content in response body');
      return null;
    } catch (error) {
      Logger.log(`API Error (attempt ${attempt + 1}): ${error.message}`);
      if (attempt < MAX_RETRIES - 1) {
        Utilities.sleep(Math.pow(2, attempt + 1) * 1000);
        continue;
      }
      return null;
    }
  }

  Logger.log('API call failed after all retry attempts');
  return null;
}


// ============================================================================
// SECTION 9: ORGANIZATION PLAN SHEET (Visual Output)
// ============================================================================

// ============================================================================
// BRAND THEME — MILO.LIFE.OS
// ============================================================================
//
// ALL spreadsheet output is branded: every sheet the script builds (inventory,
// classifications, plan, approval queues, logs) uses this palette via the
// applyBrandedTitle / applyBrandedHeader / applyBrandedBody helpers.
// When adding new sheets or features, use those helpers so output stays
// on brand. The ONE exception is the font: Google Sheets cannot load custom
// brand fonts, so Roboto stands in. Change colors here to re-skin everything.

const BRAND = {
  ACCENT:     '#FFC600',   // Gold accent
  LIGHT:      '#F7F6F3',   // Off-white background
  DARK:       '#1F1F21',   // Near-black text/headers
  FONT:       'Roboto',    // Brand font stand-in (custom fonts unavailable in Sheets)
  // Excel palette light tints for status colors
  STATUS_GREEN:  '#C6EFCE',
  STATUS_YELLOW: '#FFEB9C',
  STATUS_RED:    '#FFC7CE'
};

/**
 * Formats a header string in the branded style:
 * ALL CAPS, one space between each letter, three spaces between words.
 * e.g., "Current Name" → "C U R R E N T   N A M E"
 */
function brandHeader(text) {
  return text.toUpperCase().split(' ').map(word =>
    word.split('').join(' ')
  ).join('   ');
}

/**
 * Applies branded header formatting to a row range.
 * Dark background, accent-colored text, Roboto, spaced lettering.
 */
function applyBrandedHeader(sheet, row, numCols) {
  const range = sheet.getRange(row, 1, 1, numCols);
  range.setFontFamily(BRAND.FONT)
       .setFontWeight('bold')
       .setFontSize(12)
       .setBackground(BRAND.DARK)
       .setFontColor('#FFFFFF')
       .setHorizontalAlignment('center')
       .setVerticalAlignment('middle');
  // Column divider borders between header cells
  try {
    range.setBorder(true, true, true, true, true, false, '#555555', SpreadsheetApp.BorderStyle.SOLID);
  } catch (e) {
    Logger.log('Border styling skipped: ' + e.message);
  }
}

/**
 * Applies branded body formatting to a data range.
 * Light background, dark text, Roboto, size 10.
 */
function applyBrandedBody(sheet, startRow, numRows, numCols) {
  if (numRows <= 0) return;
  const range = sheet.getRange(startRow, 1, numRows, numCols);
  range.setFontFamily(BRAND.FONT)
       .setFontSize(10)
       .setBackground(BRAND.LIGHT)
       .setFontColor(BRAND.DARK);
}

/**
 * Writes and formats the branded title row at the top of a sheet.
 * Black text on white background, centered.
 */
function applyBrandedTitle(sheet, numCols) {
  const miloBrand = 'M I L O . L I F E . O S';
  const titleText = miloBrand + '   ' + brandHeader('Drive Organization Agent');
  sheet.getRange(1, 1).setValue(titleText);
  sheet.getRange(1, 1, 1, numCols).merge()
    .setFontFamily(BRAND.FONT)
    .setFontWeight('bold')
    .setFontSize(22)
    .setBackground('#FFFFFF')
    .setFontColor(BRAND.DARK)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');
}

/**
 * Color palette for the organization plan sheet.
 * Each action type gets a distinct color so you can scan at a glance.
 */
const PLAN_COLORS = {
  RENAME_FOLDER:    { bg: BRAND.STATUS_YELLOW, font: BRAND.DARK },
  CREATE_FOLDER:    { bg: BRAND.STATUS_GREEN,  font: BRAND.DARK },
  CREATE_SUBFOLDER: { bg: BRAND.STATUS_GREEN,  font: BRAND.DARK },
  MOVE_FILE:        { bg: BRAND.LIGHT,         font: BRAND.DARK },
  MOVE_FOLDER:      { bg: '#D6E4F0',           font: BRAND.DARK },  // light blue — whole-folder moves
  FLAG_CONSOLIDATE: { bg: BRAND.STATUS_RED,    font: BRAND.DARK },
  FLAG_REVIEW:      { bg: BRAND.STATUS_RED,    font: BRAND.DARK },
  PILLAR_HEADER:    { bg: BRAND.DARK,          font: '#FFFFFF' },
  SECTION_HEADER:   { bg: BRAND.ACCENT,        font: BRAND.DARK },  // gold — top-level plan sections
  SUMMARY:          { bg: BRAND.ACCENT,        font: BRAND.DARK }
};

/**
 * Writes the Organization Plan sheet with visual formatting:
 *   - Summary block at top with action counts
 *   - Grouped by pillar with bold header rows
 *   - Color-coded rows by action type
 *   - All rows default to APPROVED (reject what you don't want)
 *   - Conditional formatting: REJECTED rows turn gray
 *
 * @param {Spreadsheet} ss - The active spreadsheet
 * @param {Array} allActions - Combined array of action objects
 */
function writePlanSheet(ss, allActions) {
  let planSheet = ss.getSheetByName(ORG_PLAN_SHEET_NAME);
  if (!planSheet) {
    planSheet = ss.insertSheet(ORG_PLAN_SHEET_NAME);
  } else {
    planSheet.clear();
    // Clear existing conditional formatting and data validations
    planSheet.clearConditionalFormatRules();
    const lastValRow = planSheet.getMaxRows();
    const lastValCol = planSheet.getMaxColumns();
    if (lastValRow > 0 && lastValCol > 0) {
      planSheet.getRange(1, 1, lastValRow, lastValCol).clearDataValidations();
    }
  }

  const numCols = 8;

  // --- TITLE + SUMMARY BLOCK (rows 1-7) ---
  const actionCounts = {};
  for (const a of allActions) {
    actionCounts[a.action] = (actionCounts[a.action] || 0) + 1;
  }

  // Title row (row 1) — shared branded title
  applyBrandedTitle(planSheet, numCols);

  // Subtitle row (row 2)
  planSheet.getRange(2, 1).setValue(brandHeader('Organization Plan Summary'));
  planSheet.getRange(2, 1, 1, numCols).merge()
    .setFontFamily(BRAND.FONT).setFontWeight('bold').setFontSize(12)
    .setBackground(BRAND.DARK).setFontColor('#FFFFFF')
    .setHorizontalAlignment('center').setVerticalAlignment('middle');

  // Summary rows use COUNTIF formulas so counts update live as you change dropdowns.
  // dataStartRow = 8 is the HEADER row. Description row is 9. Data starts at row 10.
  const dataStartRow = 8;
  const dataFirstRow = dataStartRow + 2; // row 10 — first actual data row (after header + description)

  const summaryLines = [
    ['Approved Actions:', '', 'Pending Your Review:', '', '', '', '', ''],
    [
      'Rename:', '', 'Create:', '', 'Move:', '', 'Review:', ''
    ],
    ['High-confidence rows default to APPROVED. Medium-confidence rows default to PENDING — switch them to APPROVED to include them. Low-confidence files are routed to 0_NEEDS_REVIEW.', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', ''],  // spacer
    ['', '', '', '', '', '', '', '']   // spacer
  ];

  planSheet.getRange(3, 1, summaryLines.length, numCols).setValues(summaryLines);
  planSheet.getRange(3, 1, summaryLines.length, numCols)
    .setFontFamily(BRAND.FONT).setFontSize(10).setBackground(BRAND.LIGHT).setFontColor(BRAND.DARK);

  // Row 3: Total approved count + pending count (size 12 subheader)
  planSheet.getRange(3, 1).setFontWeight('bold').setFontSize(12);
  planSheet.getRange(3, 2).setFormula(`=COUNTIF(H${dataFirstRow}:H,"APPROVED")`).setFontWeight('bold').setFontSize(12).setHorizontalAlignment('left');
  planSheet.getRange(3, 3).setFontWeight('bold').setFontSize(12);
  planSheet.getRange(3, 4).setFormula(`=COUNTIF(H${dataFirstRow}:H,"PENDING")`).setFontWeight('bold').setFontSize(12).setFontColor('#E65100').setHorizontalAlignment('left');

  // Row 4: Per-action-type approved counts (size 12 subheader, color-coded, left-aligned numbers)
  planSheet.getRange(4, 1).setFontWeight('bold').setFontSize(12);
  planSheet.getRange(4, 2).setFormula(`=COUNTIFS(A${dataFirstRow}:A,"RENAME_FOLDER",H${dataFirstRow}:H,"APPROVED")`)
    .setFontWeight('bold').setFontSize(12).setHorizontalAlignment('left');
  planSheet.getRange(4, 3).setFontWeight('bold').setFontSize(12);
  planSheet.getRange(4, 4).setFormula(`=COUNTIFS(A${dataFirstRow}:A,"CREATE_FOLDER",H${dataFirstRow}:H,"APPROVED")+COUNTIFS(A${dataFirstRow}:A,"CREATE_SUBFOLDER",H${dataFirstRow}:H,"APPROVED")`)
    .setFontWeight('bold').setFontSize(12).setFontColor('#2E7D32').setHorizontalAlignment('left');
  planSheet.getRange(4, 5).setFontWeight('bold').setFontSize(12);
  planSheet.getRange(4, 6).setFormula(`=COUNTIFS(A${dataFirstRow}:A,"MOVE_FILE",H${dataFirstRow}:H,"APPROVED")+COUNTIFS(A${dataFirstRow}:A,"MOVE_FOLDER",H${dataFirstRow}:H,"APPROVED")`)
    .setFontWeight('bold').setFontSize(12).setFontColor('#1565C0').setHorizontalAlignment('left');
  planSheet.getRange(4, 7).setFontWeight('bold').setFontSize(12);
  planSheet.getRange(4, 8).setFormula(`=COUNTIFS(A${dataFirstRow}:A,"FLAG_CONSOLIDATE",H${dataFirstRow}:H,"APPROVED")+COUNTIFS(A${dataFirstRow}:A,"FLAG_REVIEW",H${dataFirstRow}:H,"APPROVED")`)
    .setFontWeight('bold').setFontSize(12).setFontColor('#F9A825').setHorizontalAlignment('left');

  // Row 5: instruction text
  planSheet.getRange(5, 1, 1, numCols).merge().setFontStyle('italic').setFontColor('#999999');

  // --- HEADERS (size 12 subheader) ---
  const planHeaders = [
    brandHeader('Action'), brandHeader('Target ID'), brandHeader('Current Name'),
    brandHeader('New Name / Destination'), brandHeader('Parent Pillar'),
    brandHeader('Reason'), brandHeader('File Count'), brandHeader('Status')
  ];
  planSheet.getRange(dataStartRow, 1, 1, numCols).setValues([planHeaders]);
  applyBrandedHeader(planSheet, dataStartRow, numCols);
  planSheet.getRange(dataStartRow, 1, 1, numCols).setFontSize(12);

  // Description row beneath headers
  const planDescRow = [
    'What the script will do',
    'Internal reference',
    'Current file or folder name',
    'Where it is going or new name',
    'Which pillar section',
    'Why the script chose this',
    'Files affected',
    'Your decision (dropdown)'
  ];
  planSheet.getRange(dataStartRow + 1, 1, 1, numCols).setValues([planDescRow]);
  planSheet.getRange(dataStartRow + 1, 1, 1, numCols)
    .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
    .setFontColor('#999999').setBackground(BRAND.LIGHT);

  planSheet.setFrozenRows(dataStartRow + 1);

  if (allActions.length === 0) {
    planSheet.getRange(dataFirstRow, 1).setValue('No actions needed. Your Drive structure looks good.');
    return;
  }

  // --- SORT ACTIONS BY PILLAR, THEN ACTION TYPE ---
  const actionPriority = {
    'MOVE_FOLDER': 0,
    'RENAME_FOLDER': 1,
    'CREATE_FOLDER': 2,
    'CREATE_SUBFOLDER': 3,
    'FLAG_CONSOLIDATE': 4,
    'FLAG_REVIEW': 5,
    'MOVE_FILE': 6
  };

  const sortByPillar = (a, b) => {
    const pillarA = String(a.parent || 'ZZZ');
    const pillarB = String(b.parent || 'ZZZ');
    if (pillarA !== pillarB) return pillarA.localeCompare(pillarB);
    return (actionPriority[a.action] || 99) - (actionPriority[b.action] || 99);
  };

  // Partition into two sections: whole-folder moves vs individual files & structure
  const folderSection = allActions.filter(a => a.action === 'MOVE_FOLDER').sort(sortByPillar);
  const fileSection = allActions.filter(a => a.action !== 'MOVE_FOLDER').sort(sortByPillar);

  /**
   * Default status by graduated confidence:
   *   moves with confidence >= CONF_AUTO_APPROVE → APPROVED
   *   moves below that → PENDING (must be actively approved)
   *   structural actions (renames, creates, flags) → APPROVED (safe/mechanical)
   */
  const defaultStatus = (a) => {
    if (a.action === 'MOVE_FILE' || a.action === 'MOVE_FOLDER') {
      // Triage moves (into review/deletion staging) are the safe path — always default APPROVED
      const dest = (a.destination || a.newName || '').toString();
      if (dest.indexOf('0_NEEDS_REVIEW') === 0 || dest.indexOf('00_PENDING_DELETION') === 0) return 'APPROVED';
      const conf = parseInt(a.confidence, 10);
      if (!isNaN(conf) && conf < CONF_AUTO_APPROVE) return 'PENDING';
    }
    return 'APPROVED';
  };

  // --- BUILD ALL ROWS IN MEMORY FIRST, THEN BATCH-WRITE ---
  const allRows = [];           // [row data arrays]
  const sectionHeaderRows = []; // indices (within allRows) that are big section headers
  const pillarHeaderRows = [];  // indices (within allRows) that are pillar headers
  const pillarDescRows = [];    // indices (within allRows) that are pillar description rows
  const actionRowMeta = [];     // { index, action } for color coding

  const pushSection = (title, subtitle, actions) => {
    if (actions.length === 0) return;

    // Big section header (gold)
    sectionHeaderRows.push(allRows.length);
    allRows.push([title, '', '', '', '', '', '', '']);
    if (subtitle) {
      pillarDescRows.push(allRows.length);
      allRows.push([subtitle, '', '', '', '', '', '', '']);
    }

    let currentPillar = null;
    for (const a of actions) {
      const pillar = String(a.parent || 'ROOT');

      // Insert pillar section header + description when the pillar changes
      if (pillar !== currentPillar) {
        currentPillar = pillar;
        const pillarDesc = PILLAR_ANCHORS[pillar]
          ? PILLAR_ANCHORS[pillar].description.substring(0, 100)
          : '';

        // Row 1: Pillar name only (bold, dark bg)
        pillarHeaderRows.push(allRows.length);
        allRows.push([pillar, '', '', '', '', '', '', '']);

        // Row 2: Description (italic, gray — matches column description style)
        if (pillarDesc) {
          pillarDescRows.push(allRows.length);
          allRows.push([pillarDesc, '', '', '', '', '', '', '']);
        }
      }

      // Action row
      actionRowMeta.push({ index: allRows.length, action: a.action });
      allRows.push([
        a.action,
        a.targetId || '',
        a.currentName || '',
        a.newName || a.destination || '',
        pillar,
        a.reason || '',
        a.fileCount || '',
        defaultStatus(a)
      ]);
    }
  };

  pushSection(
    'SECTION 1 — FOLDER MOVES (whole folders moved intact)',
    'Each row moves an entire folder, keeping its contents together. The folder keeps its own name and lands under the destination path.',
    folderSection
  );
  pushSection(
    'SECTION 2 — INDIVIDUAL FILES & STRUCTURE',
    'Loose files, files from mixed folders, and structural changes (renames, new folders, consolidation flags).',
    fileSection
  );

  // --- BATCH WRITE all rows at once ---
  if (allRows.length > 0) {
    planSheet.getRange(dataFirstRow, 1, allRows.length, numCols).setValues(allRows);
    applyBrandedBody(planSheet, dataFirstRow, allRows.length, numCols);
  }

  // --- APPLY FORMATTING IN BATCHES ---
  // Big section headers: merge cells, bold, gold background
  for (const idx of sectionHeaderRows) {
    const sheetRow = dataFirstRow + idx;
    planSheet.getRange(sheetRow, 1, 1, numCols).merge()
      .setFontWeight('bold').setFontSize(14)
      .setFontFamily(BRAND.FONT)
      .setBackground(PLAN_COLORS.SECTION_HEADER.bg)
      .setFontColor(PLAN_COLORS.SECTION_HEADER.font)
      .setHorizontalAlignment('left');
  }

  // Pillar headers: merge cells, bold, dark background
  for (const idx of pillarHeaderRows) {
    const sheetRow = dataFirstRow + idx;
    planSheet.getRange(sheetRow, 1, 1, numCols).merge()
      .setFontWeight('bold').setFontSize(12)
      .setFontFamily(BRAND.FONT)
      .setBackground(PLAN_COLORS.PILLAR_HEADER.bg)
      .setFontColor(PLAN_COLORS.PILLAR_HEADER.font);
  }

  // Pillar descriptions: merge cells, italic gray (matches row 9 column descriptions)
  for (const idx of pillarDescRows) {
    const sheetRow = dataFirstRow + idx;
    planSheet.getRange(sheetRow, 1, 1, numCols).merge()
      .setFontSize(10).setFontStyle('italic')
      .setFontFamily(BRAND.FONT)
      .setFontColor('#999999')
      .setBackground(BRAND.LIGHT);
  }

  // Action row colors: batch by action type to reduce API calls
  const colorGroups = {};
  for (const meta of actionRowMeta) {
    const colors = PLAN_COLORS[meta.action];
    if (colors) {
      const key = `${colors.bg}|${colors.font}`;
      if (!colorGroups[key]) colorGroups[key] = { bg: colors.bg, font: colors.font, rows: [] };
      colorGroups[key].rows.push(dataFirstRow + meta.index);
    }
  }

  // Apply each color group using range lists
  for (const group of Object.values(colorGroups)) {
    // Process in chunks of 100 rows to avoid single-call limits
    const chunkSize = 100;
    for (let c = 0; c < group.rows.length; c += chunkSize) {
      const chunk = group.rows.slice(c, c + chunkSize);
      const ranges = chunk.map(r => planSheet.getRange(r, 1, 1, numCols));
      const rangeList = planSheet.getRangeList(chunk.map(r => `A${r}:H${r}`));
      rangeList.setBackground(group.bg).setFontColor(group.font);
    }
  }

  // --- STATUS DROPDOWN VALIDATION (apply to entire Status column at once) ---
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['APPROVED', 'PENDING', 'REJECTED', '0_NEEDS_REVIEW', '00_PENDING_DELETION'], true)
    .setAllowInvalid(false)
    .build();

  if (allRows.length > 0) {
    planSheet.getRange(dataFirstRow, 8, allRows.length, 1).setDataValidation(statusRule);
  }

  // --- CONDITIONAL FORMATTING ---
  const lastRow = planSheet.getLastRow();
  const dataRowCount = lastRow - dataFirstRow + 1;
  const dataRange = planSheet.getRange(dataFirstRow, 1, dataRowCount, numCols);

  // REJECTED rows: gray strikethrough
  const rejectedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$H${dataFirstRow}="REJECTED"`)
    .setBackground('#EFEFEF')
    .setFontColor('#AAAAAA')
    .setStrikethrough(true)
    .setRanges([dataRange])
    .build();

  // APPROVED rows: light green tint
  const approvedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$H${dataFirstRow}="APPROVED"`)
    .setBackground(BRAND.STATUS_GREEN)
    .setRanges([planSheet.getRange(dataFirstRow, 8, dataRowCount, 1)])
    .build();

  // PENDING rows: orange tint on status cell — needs your active approval
  const pendingRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$H${dataFirstRow}="PENDING"`)
    .setBackground('#FFE0B2')
    .setRanges([planSheet.getRange(dataFirstRow, 8, dataRowCount, 1)])
    .build();

  // NEEDS_REVIEW rows: light yellow tint
  const reviewRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$H${dataFirstRow}="0_NEEDS_REVIEW"`)
    .setBackground(BRAND.STATUS_YELLOW)
    .setRanges([planSheet.getRange(dataFirstRow, 8, dataRowCount, 1)])
    .build();

  // PENDING_DELETION rows: light red tint
  const deleteRule = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied(`=$H${dataFirstRow}="00_PENDING_DELETION"`)
    .setBackground(BRAND.STATUS_RED)
    .setRanges([planSheet.getRange(dataFirstRow, 8, dataRowCount, 1)])
    .build();

  planSheet.setConditionalFormatRules([rejectedRule, approvedRule, pendingRule, reviewRule, deleteRule]);

  // --- COLUMN WIDTHS ---
  planSheet.setColumnWidth(1, 160);  // Action
  planSheet.setColumnWidth(2, 100);  // Target ID (narrow, usually for reference)
  planSheet.setColumnWidth(3, 250);  // Current Name
  planSheet.setColumnWidth(4, 250);  // New Name / Destination
  planSheet.setColumnWidth(5, 180);  // Parent Pillar
  planSheet.setColumnWidth(6, 320);  // Reason
  planSheet.setColumnWidth(7, 90);   // File Count
  planSheet.setColumnWidth(8, 110);  // Status

  // Hide the Target ID column (useful for execution but clutters the review)
  planSheet.hideColumn(planSheet.getRange(1, 2));

  Logger.log(`Plan sheet written: ${allActions.length} actions across ${Object.keys(actionCounts).length} action types`);
}


// ============================================================================
// SECTION 10: GENERAL SHEET UTILITIES
// ============================================================================

/**
 * Gets or creates the log sheet.
 */
function getOrCreateLogSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(LOG_SHEET_NAME);
  return sheet;
}

/**
 * Adds branded header row to log sheet.
 */
function addLogHeader(sheet) {
  // Skip if header already exists (avoid duplicating on re-runs)
  if (sheet.getLastRow() >= 1 && sheet.getRange(1, 1).getValue() !== '') return;

  const headers = ['Action', 'Status', 'Current Name', 'New Name', 'Parent Folder', 'Timestamp'];

  // Title row (row 1)
  applyBrandedTitle(sheet, headers.length);

  // Header row (row 2)
  const brandedHeaders = headers.map(h => brandHeader(h));
  sheet.appendRow(brandedHeaders);
  applyBrandedHeader(sheet, 2, headers.length);

  // Description row (row 3)
  const logDescRow = [
    'What happened', 'Result of the action',
    'Original file or folder name', 'Updated name (if renamed)',
    'Folder this item sits in', 'When this ran'
  ];
  sheet.appendRow(logDescRow);
  sheet.getRange(3, 1, 1, headers.length)
    .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
    .setFontColor('#999999').setBackground(BRAND.LIGHT);

  sheet.setFrozenRows(3);
  sheet.setColumnWidth(1, 160);  // Action
  sheet.setColumnWidth(2, 120);  // Status
  sheet.setColumnWidth(3, 280);  // Current Name
  sheet.setColumnWidth(4, 280);  // New Name
  sheet.setColumnWidth(5, 200);  // Parent Folder
  sheet.setColumnWidth(6, 180);  // Timestamp
}

/**
 * Adds a row to the log sheet.
 */
function addLogRow(sheet, action) {
  sheet.appendRow([
    action.type || 'UNKNOWN',
    action.status || 'PENDING',
    action.currentName || '',
    action.newName || '',
    action.parentFolder || '',
    new Date().toISOString()
  ]);
}

/**
 * Clears log sheet except headers.
 */
function clearLogSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 3) sheet.deleteRows(4, lastRow - 3);
}

/**
 * Gets or creates the RENAME_APPROVAL sheet.
 */
function getOrCreateApprovalSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(RENAME_APPROVAL_SHEET);
  const needsSetup = !sheet || sheet.getLastRow() < 1 || sheet.getRange(1, 1).getValue() === '';

  if (!sheet) {
    sheet = ss.insertSheet(RENAME_APPROVAL_SHEET);
  }
  if (needsSetup) {
    sheet.clear();
    const headers = ['Current Name', 'Suggested Name', 'Status', 'Folder', 'File Type', 'File ID'];

    // Title row (row 1)
    applyBrandedTitle(sheet, headers.length);

    // Header row (row 2)
    const brandedHeaders = headers.map(h => brandHeader(h));
    sheet.appendRow(brandedHeaders);
    applyBrandedHeader(sheet, 2, headers.length);

    // Description row (row 3)
    const approvalDescRow = [
      'Original file name', 'AI-suggested new name',
      'Your decision (dropdown)', 'Folder the file lives in',
      'Doc, Sheet, PDF, etc.', 'Google Drive file ID'
    ];
    sheet.appendRow(approvalDescRow);
    sheet.getRange(3, 1, 1, headers.length)
      .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
      .setFontColor('#999999').setBackground(BRAND.LIGHT);

    sheet.setFrozenRows(3);

    sheet.setColumnWidth(1, 280);  // Current Name
    sheet.setColumnWidth(2, 280);  // Suggested Name
    sheet.setColumnWidth(3, 130);  // Status
    sheet.setColumnWidth(4, 200);  // Folder
    sheet.setColumnWidth(5, 150);  // File Type
    sheet.setColumnWidth(6, 280);  // File ID

    // Status dropdown starts at row 4 (after title + header + description)
    const statusRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(['APPROVED', 'REJECTED'], true)
      .setAllowInvalid(false)
      .build();
    sheet.getRange(4, 3, 499, 1).setDataValidation(statusRule);

    // Conditional formatting for status column (col 3)
    const approvedRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('APPROVED')
      .setBackground(BRAND.STATUS_GREEN)
      .setRanges([sheet.getRange(4, 3, 499, 1)])
      .build();
    const rejectedRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('REJECTED')
      .setBackground(BRAND.STATUS_RED)
      .setRanges([sheet.getRange(4, 3, 499, 1)])
      .build();
    sheet.setConditionalFormatRules([approvedRule, rejectedRule]);
  }

  return sheet;
}

/**
 * Clears the approval sheet except headers.
 */
function clearApprovalSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow > 3) sheet.deleteRows(4, lastRow - 3);
}

/**
 * Adds a row to the RENAME_APPROVAL sheet.
 */
function addApprovalRow(sheet, fileId, currentName, suggestedName, folderName, mimeType) {
  // Column order: Current Name, Suggested Name, Status, Folder, File Type, File ID
  sheet.appendRow([currentName, suggestedName, '', folderName, mimeType, fileId]);
}

// ============================================================================
// SECTION 10B: MOVE LOG + UNDO LAST RUN
// ============================================================================
//
// Every executed move, rename, and folder creation is logged to MOVE_LOG with
// a run ID. "Undo Last Run" reverses the most recent execution: files and
// folders move back to where they came from, renames revert, and folders the
// run created are trashed if still empty. You can run it any time after an
// execute step (Pass 3, Pass 4 renames, or an inbox execute).

// Column indices for MOVE_LOG (0-based)
const MLOG = {
  RUN: 0, TS: 1, ACTION: 2, NAME: 3, ID: 4,
  FROM: 5, DEST: 6, OLD_NAME: 7, NEW_NAME: 8, UNDONE: 9
};

/**
 * Gets or creates the MOVE_LOG sheet.
 * NOT cleared by Reset All — it is the undo history.
 */
function getOrCreateMoveLogSheet_() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(MOVE_LOG_SHEET);
  const needsSetup = !sheet || sheet.getLastRow() < 1 || sheet.getRange(1, 1).getValue() === '';

  if (!sheet) {
    sheet = ss.insertSheet(MOVE_LOG_SHEET);
  }
  if (needsSetup) {
    sheet.clear();
    const headers = ['Run ID', 'Timestamp', 'Action', 'Item Name', 'Item ID',
                     'From Parent ID', 'Destination', 'Old Name', 'New Name', 'Undone'];

    applyBrandedTitle(sheet, headers.length);

    const brandedHeaders = headers.map(h => brandHeader(h));
    sheet.appendRow(brandedHeaders);
    applyBrandedHeader(sheet, 2, headers.length);

    const descRow = [
      'Groups actions from one execution', 'When it happened', 'What was done',
      'File or folder name', 'Google Drive ID', 'Where it came from',
      'Where it went', 'Name before rename', 'Name after rename',
      'YES once reversed by Undo'
    ];
    sheet.appendRow(descRow);
    sheet.getRange(3, 1, 1, headers.length)
      .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
      .setFontColor('#999999').setBackground(BRAND.LIGHT);

    sheet.setFrozenRows(3);

    sheet.setColumnWidth(1, 150);   // Run ID
    sheet.setColumnWidth(2, 170);   // Timestamp
    sheet.setColumnWidth(3, 130);   // Action
    sheet.setColumnWidth(4, 260);   // Item Name
    sheet.setColumnWidth(5, 280);   // Item ID
    sheet.setColumnWidth(6, 280);   // From Parent ID
    sheet.setColumnWidth(7, 280);   // Destination
    sheet.setColumnWidth(8, 220);   // Old Name
    sheet.setColumnWidth(9, 220);   // New Name
    sheet.setColumnWidth(10, 80);   // Undone
  }
  return sheet;
}

/**
 * Returns the current run ID for an execute pass, creating one if this is
 * a fresh run. Auto-resumed continuations keep the same run ID, so one
 * logical execution = one run ID no matter how many 6-minute chunks it took.
 */
function getRunId_(propKey) {
  const props = PropertiesService.getUserProperties();
  let runId = props.getProperty(propKey);
  if (!runId) {
    runId = 'RUN_' + Date.now();
    props.setProperty(propKey, runId);
  }
  return runId;
}

/**
 * Marks an execute pass finished — its run ID is retired.
 */
function endRun_(propKey) {
  PropertiesService.getUserProperties().deleteProperty(propKey);
}

/**
 * Appends one entry to the move log.
 */
function addMoveLog_(runId, action, itemName, itemId, fromParentId, destination, oldName, newName) {
  try {
    const sheet = getOrCreateMoveLogSheet_();
    sheet.appendRow([
      runId, new Date().toISOString(), action, itemName || '', itemId || '',
      fromParentId || '', destination || '', oldName || '', newName || '', ''
    ]);
  } catch (logErr) {
    Logger.log(`WARNING: Could not write move log entry: ${logErr.message}`);
  }
}

/**
 * UNDO LAST RUN — reverses the most recent execution recorded in MOVE_LOG.
 *   MOVE_FILE / MOVE_FOLDER → moved back to their original parent
 *   RENAME_FILE / RENAME_FOLDER → renamed back to the old name
 *   CREATE_FOLDER → trashed, but only if still empty
 * Actions are reversed in reverse order. Safe to re-run if it hits the
 * time limit — already-undone rows are skipped.
 */
function undoLastRun() {
  const startTime = Date.now();
  const ui = SpreadsheetApp.getUi();

  try {
    const sheet = getOrCreateMoveLogSheet_();
    if (sheet.getLastRow() < 4) {
      ui.alert('Nothing to undo — the move log is empty.');
      return;
    }

    const data = sheet.getDataRange().getValues();

    // Find the most recent run that still has un-undone rows
    let latestRunId = null;
    let latestRunNum = -1;
    for (let i = 3; i < data.length; i++) {
      const runId = (data[i][MLOG.RUN] || '').toString();
      const undone = (data[i][MLOG.UNDONE] || '').toString().toUpperCase();
      if (!runId || undone === 'YES') continue;
      const num = parseInt(runId.replace('RUN_', ''), 10);
      if (!isNaN(num) && num > latestRunNum) {
        latestRunNum = num;
        latestRunId = runId;
      }
    }

    if (!latestRunId) {
      ui.alert('Nothing to undo — every logged run has already been reversed.');
      return;
    }

    // Collect that run's rows (sheet row numbers, in order)
    const runRows = [];
    for (let i = 3; i < data.length; i++) {
      if ((data[i][MLOG.RUN] || '').toString() === latestRunId &&
          (data[i][MLOG.UNDONE] || '').toString().toUpperCase() !== 'YES') {
        runRows.push(i);
      }
    }

    const runDate = data[runRows[0]][MLOG.TS];
    const confirm = ui.alert(
      'Undo Last Run',
      `Reverse ${runRows.length} actions from run ${latestRunId}\n(executed ${runDate})?\n\nMoves go back to their original location, renames revert, and folders created by the run are trashed if still empty.`,
      ui.ButtonSet.YES_NO
    );
    if (confirm !== ui.Button.YES) return;

    let undoneCount = 0;
    let errorCount = 0;
    let skippedCount = 0;

    // Reverse in REVERSE order (last action undone first)
    for (let r = runRows.length - 1; r >= 0; r--) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        Logger.log(`Time limit reached. Undone ${undoneCount} so far — run "Undo Last Run" again to continue.`);
        ui.alert(`Time limit reached after reversing ${undoneCount} actions.\n\nRun "Undo Last Run" again to continue — already-reversed rows are skipped.`);
        return;
      }

      const i = runRows[r];
      const action = (data[i][MLOG.ACTION] || '').toString();
      const itemId = (data[i][MLOG.ID] || '').toString();
      const fromParentId = (data[i][MLOG.FROM] || '').toString();
      const oldName = (data[i][MLOG.OLD_NAME] || '').toString();
      const itemName = (data[i][MLOG.NAME] || '').toString();

      try {
        switch (action) {
          case 'MOVE_FILE': {
            const file = DriveApp.getFileById(itemId);
            const backTo = DriveApp.getFolderById(fromParentId);
            file.moveTo(backTo);
            Logger.log(`UNDONE MOVE: "${itemName}" back to "${backTo.getName()}"`);
            break;
          }
          case 'MOVE_FOLDER': {
            const folder = DriveApp.getFolderById(itemId);
            const backTo = DriveApp.getFolderById(fromParentId);
            folder.moveTo(backTo);
            Logger.log(`UNDONE FOLDER MOVE: "${itemName}" back to "${backTo.getName()}"`);
            break;
          }
          case 'RENAME_FILE': {
            DriveApp.getFileById(itemId).setName(oldName);
            Logger.log(`UNDONE RENAME: back to "${oldName}"`);
            break;
          }
          case 'RENAME_FOLDER': {
            DriveApp.getFolderById(itemId).setName(oldName);
            Logger.log(`UNDONE FOLDER RENAME: back to "${oldName}"`);
            break;
          }
          case 'CREATE_FOLDER': {
            const created = DriveApp.getFolderById(itemId);
            if (!created.getFiles().hasNext() && !created.getFolders().hasNext()) {
              created.setTrashed(true);
              Logger.log(`UNDONE CREATE: trashed empty folder "${itemName}"`);
            } else {
              Logger.log(`SKIPPED CREATE undo: "${itemName}" is no longer empty`);
              skippedCount++;
              sheet.getRange(i + 1, MLOG.UNDONE + 1).setValue('SKIPPED');
              continue;
            }
            break;
          }
          default:
            Logger.log(`Unknown log action "${action}" — skipped`);
            skippedCount++;
            sheet.getRange(i + 1, MLOG.UNDONE + 1).setValue('SKIPPED');
            continue;
        }

        undoneCount++;
        sheet.getRange(i + 1, MLOG.UNDONE + 1).setValue('YES');
      } catch (undoErr) {
        Logger.log(`ERROR undoing "${itemName}": ${undoErr.message}`);
        sheet.getRange(i + 1, MLOG.UNDONE + 1).setValue('ERROR');
        errorCount++;
      }
    }

    Logger.log(`\n=== UNDO COMPLETE ===`);
    Logger.log(`Reversed: ${undoneCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);
    Logger.log('Tip: run "Scan: Flag Empty Folders" to spot any folders left empty by the undo.');

    ui.alert(
      'Undo Complete',
      `Reversed: ${undoneCount}\nSkipped: ${skippedCount}\nErrors: ${errorCount}\n\nTip: run "Scan: Flag Empty Folders" to spot folders left empty.`,
      ui.ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in undoLastRun: ${error.message}`);
    Logger.log(error.stack);
  }
}


// ============================================================================
// SECTION 10D: POST-RUN SUMMARY (handoff report)
// ============================================================================

/**
 * Builds the RUN_SUMMARY sheet from the most recent run in MOVE_LOG.
 * A branded one-pager: what was done, where files landed per pillar (with a
 * bar chart), and the client's homework folders. Auto-runs after Pass 3
 * completes; regenerate any time via menu "Report: Build Run Summary".
 */
function buildRunSummary() {
  try {
    const ss = SpreadsheetApp.getActive();
    const logSheet = ss.getSheetByName(MOVE_LOG_SHEET);
    if (!logSheet || logSheet.getLastRow() < 4) {
      SpreadsheetApp.getUi().alert('No executed runs found in MOVE_LOG yet. Run Pass 3 first.');
      return;
    }

    const data = logSheet.getDataRange().getValues();

    // Find the most recent run ID
    let latestRunId = null;
    let latestRunNum = -1;
    for (let i = 3; i < data.length; i++) {
      const runId = (data[i][MLOG.RUN] || '').toString();
      const num = parseInt(runId.replace('RUN_', ''), 10);
      if (!isNaN(num) && num > latestRunNum) {
        latestRunNum = num;
        latestRunId = runId;
      }
    }
    if (!latestRunId) {
      SpreadsheetApp.getUi().alert('No executed runs found in MOVE_LOG yet.');
      return;
    }

    // Aggregate the run (skip rows reversed by Undo)
    let filesMoved = 0, foldersMoved = 0, renames = 0, created = 0;
    let reviewCount = 0, deletionCount = 0;
    const pillarCounts = {};
    let runDate = '';

    for (let i = 3; i < data.length; i++) {
      if ((data[i][MLOG.RUN] || '').toString() !== latestRunId) continue;
      if ((data[i][MLOG.UNDONE] || '').toString().toUpperCase() === 'YES') continue;

      if (!runDate) runDate = (data[i][MLOG.TS] || '').toString().split('T')[0];
      const action = (data[i][MLOG.ACTION] || '').toString();
      const dest = (data[i][MLOG.DEST] || '').toString();
      const pillar = dest.split('/')[0];

      if (action === 'MOVE_FILE') {
        filesMoved++;
        if (pillar === '0_NEEDS_REVIEW') reviewCount++;
        else if (pillar === '00_PENDING_DELETION') deletionCount++;
        else if (pillar) pillarCounts[pillar] = (pillarCounts[pillar] || 0) + 1;
      } else if (action === 'MOVE_FOLDER') {
        foldersMoved++;
        if (pillar && pillar !== '0_NEEDS_REVIEW' && pillar !== '00_PENDING_DELETION') {
          pillarCounts[pillar] = (pillarCounts[pillar] || 0) + 1;
        }
      } else if (action === 'RENAME_FILE' || action === 'RENAME_FOLDER') {
        renames++;
      } else if (action === 'CREATE_FOLDER') {
        created++;
      }
    }

    // --- Build the sheet ---
    let sheet = ss.getSheetByName(RUN_SUMMARY_SHEET);
    if (!sheet) {
      sheet = ss.insertSheet(RUN_SUMMARY_SHEET);
    } else {
      sheet.clear();
      sheet.clearConditionalFormatRules();
    }

    const numCols = 4;
    applyBrandedTitle(sheet, numCols);

    sheet.getRange(2, 1).setValue(brandHeader('Organization Run Summary') + '          ' + runDate);
    sheet.getRange(2, 1, 1, numCols).merge()
      .setFontFamily(BRAND.FONT).setFontWeight('bold').setFontSize(12)
      .setBackground(BRAND.DARK).setFontColor('#FFFFFF')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    // Stat block
    const stats = [
      ['Files moved:', filesMoved, 'Folders moved intact:', foldersMoved],
      ['Renames applied:', renames, 'Folders created:', created],
      ['Staged for review:', reviewCount, 'Staged for deletion review:', deletionCount]
    ];
    sheet.getRange(4, 1, stats.length, numCols).setValues(stats);
    sheet.getRange(4, 1, stats.length, numCols)
      .setFontFamily(BRAND.FONT).setFontSize(12).setBackground(BRAND.LIGHT).setFontColor(BRAND.DARK);
    sheet.getRange(4, 1, stats.length, 1).setFontWeight('bold');
    sheet.getRange(4, 3, stats.length, 1).setFontWeight('bold');
    sheet.getRange(4, 2, stats.length, 1).setHorizontalAlignment('left').setFontColor('#1565C0').setFontWeight('bold');
    sheet.getRange(4, 4, stats.length, 1).setHorizontalAlignment('left').setFontColor('#2E7D32').setFontWeight('bold');

    // Pillar distribution with bar chart
    let row = 8;
    sheet.getRange(row, 1).setValue(brandHeader('Where Files Landed'));
    sheet.getRange(row, 1, 1, numCols).merge()
      .setFontFamily(BRAND.FONT).setFontWeight('bold').setFontSize(12)
      .setBackground(BRAND.DARK).setFontColor('#FFFFFF')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');
    row++;

    const pillars = Object.keys(pillarCounts).sort();
    if (pillars.length > 0) {
      const maxCount = Math.max.apply(null, pillars.map(p => pillarCounts[p]));
      const barRows = pillars.map(p => {
        const count = pillarCounts[p];
        const barLen = Math.max(1, Math.round((count / maxCount) * 40));
        return [p, count, '█'.repeat(barLen), ''];
      });
      sheet.getRange(row, 1, barRows.length, numCols).setValues(barRows);
      sheet.getRange(row, 1, barRows.length, numCols)
        .setFontFamily(BRAND.FONT).setFontSize(10).setBackground(BRAND.LIGHT).setFontColor(BRAND.DARK);
      sheet.getRange(row, 2, barRows.length, 1).setFontWeight('bold').setHorizontalAlignment('left');
      sheet.getRange(row, 3, barRows.length, 1).setFontColor(BRAND.ACCENT).setFontWeight('bold');
      row += barRows.length;
    } else {
      sheet.getRange(row, 1).setValue('No pillar moves in this run.');
      row++;
    }

    // Homework note
    row += 1;
    sheet.getRange(row, 1).setValue(
      `YOUR HOMEWORK: review 0_NEEDS_REVIEW (${reviewCount} items staged) and 00_PENDING_DELETION (${deletionCount} items staged). ` +
      'Nothing in the deletion folder is deleted until you empty it yourself.'
    );
    sheet.getRange(row, 1, 1, numCols).merge()
      .setFontFamily(BRAND.FONT).setFontSize(11).setFontStyle('italic')
      .setBackground(BRAND.ACCENT).setFontColor(BRAND.DARK).setWrap(true);

    sheet.setColumnWidth(1, 280);
    sheet.setColumnWidth(2, 90);
    sheet.setColumnWidth(3, 340);
    sheet.setColumnWidth(4, 220);

    Logger.log(`Run summary built for ${latestRunId} (${runDate}).`);
  } catch (error) {
    Logger.log(`ERROR in buildRunSummary: ${error.message}`);
    Logger.log(error.stack);
  }
}


// ============================================================================
// SECTION 10C: DUPLICATE DETECTOR (local, no AI)
// ============================================================================
//
// Finds duplicate files from the FULL_INVENTORY using pure logic — zero API
// calls. Two detection methods:
//   1. EXACT: identical name + identical byte size (size > 0). The newest
//      copy is kept as the original; older copies are flagged.
//   2. COPY PATTERN: names like "Copy of X", "X (1)", "X - Copy" where a
//      file named X exists. Google-native files (size 0) are only caught
//      by this method, never by size matching.
// Flagged files go to the DUPLICATES sheet for review. Approved rows are
// STAGED in 00_PENDING_DELETION — never deleted — and the moves are logged
// so Undo Last Run can reverse them.

/**
 * Scans the inventory for duplicate files. No API calls.
 */
function scanDuplicates() {
  try {
    const ss = SpreadsheetApp.getActive();
    const invSheet = ss.getSheetByName(INVENTORY_SHEET_NAME);
    if (!invSheet || invSheet.getLastRow() < 4) {
      Logger.log('ERROR: No inventory found. Run Pass 1 first.');
      SpreadsheetApp.getUi().alert('No inventory found. Run Pass 1 (Full Scan) first.');
      return;
    }

    const invData = invSheet.getDataRange().getValues();

    // Collect files (skip folders and anything already staged for deletion)
    const files = [];
    for (let i = 3; i < invData.length; i++) {
      const row = invData[i];
      if (row[INV.IS_FOLDER] === 'YES') continue;
      const path = (row[INV.PATH] || '').toString();
      if (path.indexOf('00_PENDING_DELETION') !== -1) continue;
      files.push({
        id: row[INV.ID],
        name: (row[INV.NAME] || '').toString(),
        size: parseInt(row[INV.SIZE], 10) || 0,
        path: path,
        modified: new Date(row[INV.MODIFIED])
      });
    }

    const flagged = [];         // rows for the DUPLICATES sheet
    const flaggedIds = {};      // avoid double-flagging

    // --- Method 1: exact name + size groups (size > 0 only) ---
    const groups = {};
    for (const f of files) {
      if (f.size <= 0) continue; // Google-native files excluded from size matching
      const key = f.name.toLowerCase() + '|' + f.size;
      if (!groups[key]) groups[key] = [];
      groups[key].push(f);
    }

    for (const key of Object.keys(groups)) {
      const group = groups[key];
      if (group.length < 2) continue;
      // Keep the newest as the original; flag the rest
      group.sort((a, b) => b.modified - a.modified);
      const original = group[0];
      for (let g = 1; g < group.length; g++) {
        const dup = group[g];
        if (flaggedIds[dup.id]) continue;
        flaggedIds[dup.id] = true;
        flagged.push([
          dup.name,
          `${original.name}  —  in ${original.path}`,
          'EXACT (name + size)',
          dup.size,
          dup.path,
          dup.modified.toISOString().split('T')[0],
          'APPROVED',
          dup.id
        ]);
      }
    }

    // --- Method 2: copy-pattern names where the original exists ---
    const namesLower = {};
    for (const f of files) {
      const nl = f.name.toLowerCase();
      if (!namesLower[nl]) namesLower[nl] = f;
    }

    const copyPatterns = [
      { re: /^copy of (.+)$/i,               original: (m) => m[1] },
      { re: /^(.+?) \(\d+\)(\.[^.]+)?$/i,    original: (m) => m[1] + (m[2] || '') },
      { re: /^(.+?) - copy(\.[^.]+)?$/i,     original: (m) => m[1] + (m[2] || '') }
    ];

    for (const f of files) {
      if (flaggedIds[f.id]) continue;
      for (const pat of copyPatterns) {
        const m = f.name.match(pat.re);
        if (!m) continue;
        const originalName = pat.original(m).toLowerCase();
        const original = namesLower[originalName];
        if (original && original.id !== f.id) {
          flaggedIds[f.id] = true;
          // Same size (and size known) → high certainty. Otherwise needs a look.
          const sizeMatch = f.size > 0 && f.size === original.size;
          flagged.push([
            f.name,
            `${original.name}  —  in ${original.path}`,
            sizeMatch ? 'COPY PATTERN (size match)' : 'COPY PATTERN (verify)',
            f.size,
            f.path,
            f.modified.toISOString().split('T')[0],
            sizeMatch ? 'APPROVED' : 'PENDING',
            f.id
          ]);
          break;
        }
      }
    }

    // --- Write the DUPLICATES sheet ---
    let dupSheet = ss.getSheetByName(DUPLICATES_SHEET);
    if (!dupSheet) {
      dupSheet = ss.insertSheet(DUPLICATES_SHEET);
    } else {
      dupSheet.clear();
      dupSheet.clearConditionalFormatRules();
      const mr = dupSheet.getMaxRows(), mc = dupSheet.getMaxColumns();
      if (mr > 0 && mc > 0) dupSheet.getRange(1, 1, mr, mc).clearDataValidations();
    }

    const headers = ['File Name', 'Duplicate Of', 'Match Type', 'Size (bytes)',
                     'Folder Path', 'Last Modified', 'Status', 'File ID'];
    const numCols = headers.length;

    applyBrandedTitle(dupSheet, numCols);

    dupSheet.getRange(2, 1).setValue(brandHeader('Duplicate Review') + '          ' + flagged.length + ' found');
    dupSheet.getRange(2, 1, 1, numCols).merge()
      .setFontFamily(BRAND.FONT).setFontWeight('bold').setFontSize(12)
      .setBackground(BRAND.DARK).setFontColor('#FFFFFF')
      .setHorizontalAlignment('center').setVerticalAlignment('middle');

    const brandedHeaders = headers.map(h => brandHeader(h));
    dupSheet.getRange(3, 1, 1, numCols).setValues([brandedHeaders]);
    applyBrandedHeader(dupSheet, 3, numCols);

    const descRow = [
      'The suspected duplicate', 'The file it duplicates (kept)',
      'How it was detected', 'File size in bytes',
      'Where the duplicate sits', 'When it was last changed',
      'APPROVED = stage in 00_PENDING_DELETION', 'Google Drive file ID'
    ];
    dupSheet.getRange(4, 1, 1, numCols).setValues([descRow]);
    dupSheet.getRange(4, 1, 1, numCols)
      .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
      .setFontColor('#999999').setBackground(BRAND.LIGHT);

    dupSheet.setFrozenRows(4);

    const DATA_START = 5;
    if (flagged.length > 0) {
      dupSheet.getRange(DATA_START, 1, flagged.length, numCols).setValues(flagged);
      applyBrandedBody(dupSheet, DATA_START, flagged.length, numCols);

      // Status dropdown + colors (column 7)
      const statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['APPROVED', 'PENDING', 'REJECTED'], true)
        .setAllowInvalid(false)
        .build();
      dupSheet.getRange(DATA_START, 7, flagged.length, 1).setDataValidation(statusRule);

      const statusRange = dupSheet.getRange(DATA_START, 7, flagged.length, 1);
      const fullRange = dupSheet.getRange(DATA_START, 1, flagged.length, numCols);
      const approvedRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$G${DATA_START}="APPROVED"`)
        .setBackground(BRAND.STATUS_GREEN).setRanges([statusRange]).build();
      const pendingRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$G${DATA_START}="PENDING"`)
        .setBackground('#FFE0B2').setRanges([statusRange]).build();
      const rejectedRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$G${DATA_START}="REJECTED"`)
        .setBackground('#EFEFEF').setFontColor('#AAAAAA').setStrikethrough(true)
        .setRanges([fullRange]).build();
      dupSheet.setConditionalFormatRules([rejectedRule, approvedRule, pendingRule]);
    } else {
      dupSheet.getRange(DATA_START, 1).setValue('No duplicates found. Your Drive is clean.');
    }

    dupSheet.setColumnWidth(1, 280);  // File Name
    dupSheet.setColumnWidth(2, 340);  // Duplicate Of
    dupSheet.setColumnWidth(3, 190);  // Match Type
    dupSheet.setColumnWidth(4, 100);  // Size
    dupSheet.setColumnWidth(5, 300);  // Folder Path
    dupSheet.setColumnWidth(6, 120);  // Last Modified
    dupSheet.setColumnWidth(7, 120);  // Status
    dupSheet.setColumnWidth(8, 280);  // File ID

    Logger.log(`=== DUPLICATE SCAN COMPLETE: ${flagged.length} duplicates found ===`);
    SpreadsheetApp.getUi().alert(
      'Duplicate Scan Complete',
      `${flagged.length} suspected duplicates found (zero API calls).\n\nReview the DUPLICATES sheet:\n— APPROVED rows will be staged in 00_PENDING_DELETION\n— PENDING rows need a look (name pattern matched but size differs)\n\nThen run "Scan: Move Approved Duplicates".`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in scanDuplicates: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Moves APPROVED duplicates to 00_PENDING_DELETION (staged, never deleted).
 * Every move is logged — Undo Last Run can reverse it.
 */
function executeDuplicateMoves() {
  const startTime = Date.now();
  try {
    const ss = SpreadsheetApp.getActive();
    const dupSheet = ss.getSheetByName(DUPLICATES_SHEET);
    if (!dupSheet || dupSheet.getLastRow() < 5) {
      SpreadsheetApp.getUi().alert('No duplicates sheet found. Run "Scan: Find Duplicates" first.');
      return;
    }

    const data = dupSheet.getDataRange().getValues();
    const runId = getRunId_('DUP_RUN_ID');
    let movedCount = 0;
    let errorCount = 0;

    Logger.log('=== MOVING APPROVED DUPLICATES TO 00_PENDING_DELETION ===\n');

    for (let i = 4; i < data.length; i++) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        Logger.log(`Time limit reached. Moved ${movedCount} so far — run again to continue.`);
        SpreadsheetApp.getUi().alert(`Time limit reached after ${movedCount} moves.\n\nRun "Scan: Move Approved Duplicates" again to continue.`);
        return;
      }

      const fileName = data[i][0];
      const status = (data[i][6] || '').toString().toUpperCase().trim();
      const fileId = data[i][7];

      if (status !== 'APPROVED') continue;

      try {
        const file = DriveApp.getFileById(fileId);
        const parents = file.getParents();
        const fromParentId = parents.hasNext() ? parents.next().getId() : getRootFolderId_();
        const destFolder = ensureFolderPath('00_PENDING_DELETION');
        file.moveTo(destFolder);
        movedCount++;
        addMoveLog_(runId, 'MOVE_FILE', fileName, fileId, fromParentId, '00_PENDING_DELETION', '', '');
        Logger.log(`STAGED: "${fileName}" → 00_PENDING_DELETION`);
        dupSheet.getRange(i + 1, 7).setValue('DONE');
      } catch (err) {
        Logger.log(`ERROR staging "${fileName}": ${err.message}`);
        dupSheet.getRange(i + 1, 7).setValue('ERROR');
        errorCount++;
      }
    }

    endRun_('DUP_RUN_ID');
    Logger.log(`\nStaged: ${movedCount} | Errors: ${errorCount}`);
    SpreadsheetApp.getUi().alert(
      'Duplicates Staged',
      `${movedCount} duplicates moved to 00_PENDING_DELETION.\n${errorCount} errors.\n\nNothing was deleted — review the folder and empty it yourself when ready.\n"Undo Last Run" can reverse these moves.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );

  } catch (error) {
    Logger.log(`ERROR in executeDuplicateMoves: ${error.message}`);
    Logger.log(error.stack);
  }
}


/**
 * Scans all pillar folders for empty sub-folders and logs them.
 * Does NOT delete anything — just flags them so you can review.
 * Run this after Pass 3 to clean up folders the script created that ended up empty.
 */
function flagEmptyFolders() {
  const startTime = Date.now();

  try {
    const rootFolder = DriveApp.getFolderById(getRootFolderId_());
    const logSheet = getOrCreateLogSheet();
    let emptyCount = 0;

    Logger.log('=== EMPTY FOLDER SCAN ===\n');

    // Scan each pillar folder recursively
    const pillarFolders = rootFolder.getFolders();
    while (pillarFolders.hasNext()) {
      if (Date.now() - startTime > MAX_RUN_MS) {
        Logger.log(`\nTime limit reached. Found ${emptyCount} empty folders so far.`);
        Logger.log('Run again to continue scanning.');
        return;
      }

      const pillar = pillarFolders.next();
      const results = findEmptyFoldersRecursive_(pillar, pillar.getName(), startTime);

      for (const empty of results) {
        addLogRow(logSheet, {
          type: 'EMPTY_FOLDER',
          currentName: empty.name,
          newName: '',
          parentFolder: empty.path,
          status: 'FLAGGED'
        });
        emptyCount++;
        Logger.log(`EMPTY: ${empty.path}/${empty.name}`);
      }
    }

    Logger.log(`\nScan complete. Found ${emptyCount} empty folders.`);
    Logger.log('Review the log sheet. Delete empty folders manually or leave them.');

    if (emptyCount > 0) {
      SpreadsheetApp.getUi().alert(
        `Found ${emptyCount} empty folders.\n\nCheck the log sheet for the full list.`
      );
    } else {
      SpreadsheetApp.getUi().alert('No empty folders found. Your Drive looks clean.');
    }
  } catch (error) {
    Logger.log(`ERROR in flagEmptyFolders: ${error.message}`);
  }
}

/**
 * Recursively finds empty folders inside a given folder.
 * A folder is "empty" if it has zero files AND zero non-empty sub-folders.
 */
function findEmptyFoldersRecursive_(folder, parentPath, startTime) {
  const results = [];

  if (Date.now() - startTime > MAX_RUN_MS) return results;

  const subFolders = folder.getFolders();
  const fileCount = folder.getFiles().hasNext() ? 1 : 0;
  let hasNonEmptyChild = false;

  while (subFolders.hasNext()) {
    const sub = subFolders.next();
    const childResults = findEmptyFoldersRecursive_(sub, parentPath + '/' + folder.getName(), startTime);
    results.push(...childResults);

    // If this child wasn't flagged as empty, the parent is not truly empty
    const childIsEmpty = childResults.some(r => r.name === sub.getName() && r.path === parentPath + '/' + folder.getName());
    if (!childIsEmpty) hasNonEmptyChild = true;
  }

  // A folder is empty if it has no files and no non-empty children
  if (fileCount === 0 && !hasNonEmptyChild) {
    results.push({ name: folder.getName(), path: parentPath });
  }

  return results;
}

/**
 * Resets all properties and clears sheets.
 */
function resetAll() {
  try {
    Logger.log('Resetting all properties, sheets, and triggers...');

    // Preserve the stored API key and root folder across the reset
    const props = PropertiesService.getUserProperties();
    const savedApiKey = props.getProperty('CLAUDE_API_KEY');
    const savedRootId = props.getProperty('ROOT_FOLDER_ID');
    props.deleteAllProperties();
    if (savedApiKey) props.setProperty('CLAUDE_API_KEY', savedApiKey);
    if (savedRootId) props.setProperty('ROOT_FOLDER_ID', savedRootId);

    // Clear all auto-resume triggers
    clearPass1Triggers_();
    clearPass2aTriggers_();
    clearFolderClassifyTriggers_();
    clearInboxScanTriggers_();
    clearInboxExecTriggers_();

    // NOTE: MOVE_LOG is deliberately NOT cleared — it is the undo history.
    const ss = SpreadsheetApp.getActive();
    const sheetNames = [LOG_SHEET_NAME, INVENTORY_SHEET_NAME, ORG_PLAN_SHEET_NAME,
                        RENAME_APPROVAL_SHEET, CLASSIFICATION_SHEET_NAME,
                        FOLDER_CLASSIFICATION_SHEET, DUPLICATES_SHEET, RUN_SUMMARY_SHEET,
                        INBOX_PLAN_SHEET, INBOX_HISTORY_SHEET];

    for (const name of sheetNames) {
      const sheet = ss.getSheetByName(name);
      if (sheet) sheet.clear();
    }

    Logger.log('Reset complete');
    SpreadsheetApp.getUi().alert('Everything has been reset. You can start fresh with Pass 1.');
  } catch (error) {
    Logger.log(`ERROR in resetAll: ${error.message}`);
  }
}


// ============================================================================
// SECTION 11: RESET
// ============================================================================

/**
 * Creates the custom menu when the sheet opens.
 */
// ============================================================================
// SECTION 12: INBOX — TO_ORGANIZE FOLDER WORKFLOW
// ============================================================================
//
// Weekly micro-cadence for ongoing file organization:
//   1. User drops files into TO_ORGANIZE folder
//   2. scanInbox() classifies each file and proposes a destination + rename
//   3. User reviews the INBOX_PLAN sheet (approve/reject each row)
//   4. executeInboxPlan() moves approved files and logs to INBOX_HISTORY
//
// The scan can run on-demand from the menu or on a weekly time-driven trigger.

/**
 * Finds or creates the TO_ORGANIZE folder at the root level.
 */
function ensureInboxFolder() {
  const rootFolder = DriveApp.getFolderById(getRootFolderId_());
  const folders = rootFolder.getFoldersByName(INBOX_FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  Logger.log(`Created "${INBOX_FOLDER_NAME}" folder at root.`);
  return rootFolder.createFolder(INBOX_FOLDER_NAME);
}

/**
 * Gets or creates the INBOX_HISTORY sheet with branded formatting.
 */
function getOrCreateInboxHistorySheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(INBOX_HISTORY_SHEET);

  if (!sheet) {
    sheet = ss.insertSheet(INBOX_HISTORY_SHEET);
    const headers = ['Date', 'File Name', 'New Name', 'From', 'Destination', 'Pillar', 'Confidence', 'Status'];

    // Title row (row 1)
    applyBrandedTitle(sheet, headers.length);

    // Header row (row 2)
    const brandedHeaders = headers.map(h => brandHeader(h));
    sheet.appendRow(brandedHeaders);
    applyBrandedHeader(sheet, 2, headers.length);

    // Description row (row 3)
    const descRow = [
      'When this ran', 'Original file name', 'Renamed to (if changed)',
      'TO_ORGANIZE', 'Where the file landed', 'Pillar classification',
      'AI confidence score', 'Result of the action'
    ];
    sheet.appendRow(descRow);
    sheet.getRange(3, 1, 1, headers.length)
      .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
      .setFontColor('#999999').setBackground(BRAND.LIGHT);

    sheet.setFrozenRows(3);

    sheet.setColumnWidth(1, 140);  // Date
    sheet.setColumnWidth(2, 260);  // File Name
    sheet.setColumnWidth(3, 260);  // New Name
    sheet.setColumnWidth(4, 130);  // From
    sheet.setColumnWidth(5, 300);  // Destination
    sheet.setColumnWidth(6, 180);  // Pillar
    sheet.setColumnWidth(7, 90);   // Confidence
    sheet.setColumnWidth(8, 110);  // Status
  }

  return sheet;
}

/**
 * Scans the TO_ORGANIZE folder, classifies every file using AI,
 * checks if names need reformatting, and writes results to INBOX_PLAN
 * for human approval before any moves happen.
 */
function scanInbox() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();
  loadTestMode();

  try {
    const savedIndex = parseInt(props.getProperty('INBOX_SCAN_INDEX') || '0', 10);

    const ss = SpreadsheetApp.getActive();
    const inboxFolder = ensureInboxFolder();

    // Collect all files from TO_ORGANIZE (including subfolders)
    const files = [];
    const fileIterator = inboxFolder.getFiles();
    while (fileIterator.hasNext()) {
      const file = fileIterator.next();
      files.push({
        id: file.getId(),
        name: file.getName(),
        type: file.getMimeType().split('.').pop() || 'unknown',
        mimeType: file.getMimeType(),
        parentFolder: INBOX_FOLDER_NAME,
        folderPath: INBOX_FOLDER_NAME,
        lastModified: file.getLastUpdated(),
        size: file.getSize()
      });
    }

    // Also grab files from subfolders inside TO_ORGANIZE
    const subFolders = inboxFolder.getFolders();
    while (subFolders.hasNext()) {
      const sub = subFolders.next();
      const subName = sub.getName();
      const subFiles = sub.getFiles();
      while (subFiles.hasNext()) {
        const file = subFiles.next();
        files.push({
          id: file.getId(),
          name: file.getName(),
          type: file.getMimeType().split('.').pop() || 'unknown',
          mimeType: file.getMimeType(),
          parentFolder: subName,
          folderPath: INBOX_FOLDER_NAME + '/' + subName,
          lastModified: file.getLastUpdated(),
          size: file.getSize()
        });
      }
    }

    if (files.length === 0) {
      Logger.log('TO_ORGANIZE folder is empty. Nothing to process.');
      SpreadsheetApp.getUi().alert('The TO_ORGANIZE folder is empty. Drop some files in first.');
      return;
    }

    // Create/clear the INBOX_PLAN sheet
    let planSheet = ss.getSheetByName(INBOX_PLAN_SHEET);
    if (savedIndex === 0) {
      if (!planSheet) {
        planSheet = ss.insertSheet(INBOX_PLAN_SHEET);
      } else {
        planSheet.clear();
        planSheet.clearConditionalFormatRules();
      }

      const numCols = 10;
      const headers = ['File Name', 'Pillar', 'Destination', 'New Name', 'Confidence',
                        'Entity', 'Year', 'Note', 'Status', 'File ID'];

      // Title row (row 1)
      applyBrandedTitle(planSheet, numCols);

      // Subtitle (row 2)
      planSheet.getRange(2, 1).setValue(brandHeader('Inbox Review') + '          ' + files.length + ' files');
      planSheet.getRange(2, 1, 1, numCols).merge()
        .setFontFamily(BRAND.FONT).setFontWeight('bold').setFontSize(12)
        .setBackground(BRAND.DARK).setFontColor('#FFFFFF');

      // Summary counts (row 3)
      planSheet.getRange(3, 1).setValue('Approved:');
      planSheet.getRange(3, 2).setFormula('=COUNTIF(I6:I,"APPROVED")');
      planSheet.getRange(3, 3).setValue('Rejected:');
      planSheet.getRange(3, 4).setFormula('=COUNTIF(I6:I,"REJECTED")');
      planSheet.getRange(3, 1, 1, numCols)
        .setFontFamily(BRAND.FONT).setFontSize(10).setFontWeight('bold')
        .setBackground(BRAND.LIGHT).setFontColor(BRAND.DARK);

      // Header row (row 4)
      const brandedHeaders = headers.map(h => brandHeader(h));
      planSheet.getRange(4, 1, 1, numCols).setValues([brandedHeaders]);
      applyBrandedHeader(planSheet, 4, numCols);
      planSheet.getRange(4, 1, 1, numCols).setFontSize(12);

      // Description row (row 5 — but we start data at row 5, so skip desc here)
      // Actually, let's put description at row 5 and data at row 6
      const descRow = [
        'Current file name', 'AI classification', 'Target folder path',
        'Reformatted name (if changed)', 'AI confidence (0-100)',
        'Entity extracted', 'Year extracted', 'Flags or context',
        'Your decision (dropdown)', 'Google Drive file ID'
      ];
      planSheet.getRange(5, 1, 1, numCols).setValues([descRow]);
      planSheet.getRange(5, 1, 1, numCols)
        .setFontFamily(BRAND.FONT).setFontSize(10).setFontStyle('italic')
        .setFontColor('#999999').setBackground(BRAND.LIGHT);

      planSheet.setFrozenRows(5);

      // Column widths
      planSheet.setColumnWidth(1, 260);   // File Name
      planSheet.setColumnWidth(2, 180);   // Pillar
      planSheet.setColumnWidth(3, 300);   // Destination
      planSheet.setColumnWidth(4, 260);   // New Name
      planSheet.setColumnWidth(5, 90);    // Confidence
      planSheet.setColumnWidth(6, 140);   // Entity
      planSheet.setColumnWidth(7, 70);    // Year
      planSheet.setColumnWidth(8, 250);   // Note
      planSheet.setColumnWidth(9, 120);   // Status
      planSheet.setColumnWidth(10, 280);  // File ID

      Logger.log(`=== INBOX SCAN: ${files.length} FILES IN TO_ORGANIZE ===\n`);
    } else {
      planSheet = ss.getSheetByName(INBOX_PLAN_SHEET);
      Logger.log(`=== INBOX SCAN: RESUMING (from file ${savedIndex + 1} of ${files.length}) ===\n`);
    }

    // Build pillar descriptions for the AI prompt
    const pillarDesc = {};
    for (const [key, spec] of Object.entries(PILLAR_ANCHORS)) {
      pillarDesc[key] = spec.description;
    }

    const ageCutoff = loadAgeCutoff();

    // Process in batches of 10
    const BATCH_SIZE = 10;
    const DATA_START_ROW = 6; // row 6 is first data row

    for (let batchStart = savedIndex; batchStart < files.length; batchStart += BATCH_SIZE) {
      // Test mode cap
      if (TEST_MODE && batchStart >= TEST_MODE_LIMIT) {
        Logger.log(`\nTEST MODE: Stopped after ${batchStart} files (limit: ${TEST_MODE_LIMIT})`);
        break;
      }

      // Time check
      if (Date.now() - startTime > MAX_RUN_MS) {
        props.setProperty('INBOX_SCAN_INDEX', batchStart.toString());
        clearInboxScanTriggers_();
        ScriptApp.newTrigger('scanInbox')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at file ${batchStart}/${files.length}. Auto-resuming in ~1 minute.`);
        return;
      }

      const batchEnd = Math.min(batchStart + BATCH_SIZE, files.length);
      const batch = files.slice(batchStart, batchEnd);
      Logger.log(`Classifying batch: files ${batchStart + 1}-${batchEnd} of ${files.length}`);

      const classifiedRows = classifyBatch(batch, pillarDesc, ageCutoff);

      // Build plan rows with rename check
      const planRows = [];
      for (let j = 0; j < classifiedRows.length; j++) {
        const cr = classifiedRows[j];
        const file = batch[j];
        // classifyBatch raw output order: [0]Name [1]Pillar [2]SubCat [3]TargetPath
        //   [4]Confidence [5]Entity [6]Year [7]Note [8]AgeFlag ...
        const pillar = cr[1] || '0_NEEDS_REVIEW';
        const subCat = cr[2] || '';
        const entity = cr[5] || '';
        const year = cr[6] || '';
        const confidence = cr[4] || 0;
        const note = cr[7] || '';
        const targetPath = cr[3] || pillar;

        // Check if name needs reformatting (Mode A mechanical rename)
        const currentName = file.name;
        const formattedName = generateFileName(currentName, file.mimeType);
        const newName = (formattedName !== currentName) ? formattedName : '';

        // Graduated confidence: high → APPROVED, medium → PENDING (opt in)
        const confNum = parseInt(confidence, 10) || 0;
        const rowStatus = confNum >= CONF_AUTO_APPROVE ? 'APPROVED' : 'PENDING';

        planRows.push([
          currentName,
          pillar,
          targetPath,
          newName,
          confidence,
          entity,
          year,
          note,
          rowStatus,
          file.id
        ]);
      }

      // Write batch to sheet
      if (planRows.length > 0) {
        const writeRow = DATA_START_ROW + batchStart;
        planSheet.getRange(writeRow, 1, planRows.length, 10).setValues(planRows);
        applyBrandedBody(planSheet, writeRow, planRows.length, 10);
      }

      // Pause between batches to avoid rate limits
      Utilities.sleep(1500);
    }

    // Done scanning — apply validation and conditional formatting
    props.deleteProperty('INBOX_SCAN_INDEX');
    clearInboxScanTriggers_();

    const lastRow = planSheet.getLastRow();
    const dataRows = lastRow - DATA_START_ROW + 1;

    if (dataRows > 0) {
      // Status dropdown (column 9)
      const statusRule = SpreadsheetApp.newDataValidation()
        .requireValueInList(['APPROVED', 'PENDING', 'REJECTED', '0_NEEDS_REVIEW'], true)
        .setAllowInvalid(false)
        .build();
      planSheet.getRange(DATA_START_ROW, 9, dataRows, 1).setDataValidation(statusRule);

      // Conditional formatting
      const statusRange = planSheet.getRange(DATA_START_ROW, 9, dataRows, 1);
      const fullRange = planSheet.getRange(DATA_START_ROW, 1, dataRows, 10);

      const approvedRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$I${DATA_START_ROW}="APPROVED"`)
        .setBackground(BRAND.STATUS_GREEN)
        .setRanges([statusRange])
        .build();
      const pendingRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$I${DATA_START_ROW}="PENDING"`)
        .setBackground('#FFE0B2')
        .setRanges([statusRange])
        .build();
      const rejectedRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$I${DATA_START_ROW}="REJECTED"`)
        .setBackground('#EFEFEF')
        .setFontColor('#AAAAAA')
        .setStrikethrough(true)
        .setRanges([fullRange])
        .build();
      const reviewRule = SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(`=$I${DATA_START_ROW}="0_NEEDS_REVIEW"`)
        .setBackground(BRAND.STATUS_YELLOW)
        .setRanges([statusRange])
        .build();

      planSheet.setConditionalFormatRules([rejectedRule, approvedRule, pendingRule, reviewRule]);
    }

    Logger.log(`\nINBOX SCAN COMPLETE: ${files.length} files classified.`);
    Logger.log('Review the INBOX_PLAN sheet, then run "Inbox: Execute Approved Moves" from the menu.');

  } catch (error) {
    Logger.log(`ERROR in scanInbox: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Executes approved moves from the INBOX_PLAN sheet.
 * Moves each approved file to its destination, applies rename if flagged,
 * and logs every action to INBOX_HISTORY.
 */
function executeInboxPlan() {
  const startTime = Date.now();
  const props = PropertiesService.getUserProperties();

  try {
    const savedIndex = parseInt(props.getProperty('INBOX_EXEC_INDEX') || '0', 10);

    const ss = SpreadsheetApp.getActive();
    const planSheet = ss.getSheetByName(INBOX_PLAN_SHEET);

    if (!planSheet || planSheet.getLastRow() < 6) {
      Logger.log('No INBOX_PLAN found. Run "Inbox: Scan TO_ORGANIZE" first.');
      SpreadsheetApp.getUi().alert('No inbox plan found. Run the inbox scan first.');
      return;
    }

    const historySheet = getOrCreateInboxHistorySheet();
    const data = planSheet.getDataRange().getValues();
    const DATA_START_ROW = 6;
    const today = new Date().toISOString().split('T')[0];

    let movedCount = 0;
    let renamedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    if (savedIndex === 0) {
      Logger.log('=== INBOX EXECUTE: MOVING APPROVED FILES ===\n');
    } else {
      Logger.log(`=== INBOX EXECUTE: RESUMING (from row ${savedIndex + 1}) ===\n`);
    }

    // Data starts at array index 5 (row 6 in sheet)
    const startIdx = Math.max(savedIndex, 5);

    for (let i = startIdx; i < data.length; i++) {
      // Time check
      if (Date.now() - startTime > MAX_RUN_MS) {
        props.setProperty('INBOX_EXEC_INDEX', i.toString());
        clearInboxExecTriggers_();
        ScriptApp.newTrigger('executeInboxPlan')
          .timeBased()
          .after(60 * 1000)
          .create();
        Logger.log(`\nTime limit reached at row ${i}/${data.length}. Auto-resuming in ~1 minute.`);
        return;
      }

      const fileName = data[i][0];
      const pillar = data[i][1];
      const destination = data[i][2];
      const newName = data[i][3];
      const confidence = data[i][4];
      const status = (data[i][8] || '').toString().toUpperCase().trim();
      const fileId = data[i][9];

      // Skip non-actionable rows
      if (status === 'DONE' || status === 'ERROR' || status === 'SKIPPED') continue;
      if (status === 'REJECTED') {
        skippedCount++;
        planSheet.getRange(i + 1, 9).setValue('SKIPPED');
        historySheet.appendRow([today, fileName, '', INBOX_FOLDER_NAME, '', pillar, confidence, 'SKIPPED']);
        continue;
      }
      if (status !== 'APPROVED') continue;

      try {
        const file = DriveApp.getFileById(fileId);

        // Capture origin for undo, then move to destination folder
        const inboxParents = file.getParents();
        const fromParentId = inboxParents.hasNext() ? inboxParents.next().getId() : getRootFolderId_();
        const destFolder = ensureFolderPath(destination);
        file.moveTo(destFolder);
        movedCount++;
        addMoveLog_(getRunId_('INBOX_RUN_ID'), 'MOVE_FILE', fileName, fileId, fromParentId, destination, '', '');

        // Rename if a new name was proposed
        let finalName = fileName;
        if (newName && newName.length > 0) {
          file.setName(newName);
          finalName = newName;
          renamedCount++;
          addMoveLog_(getRunId_('INBOX_RUN_ID'), 'RENAME_FILE', newName, fileId, '', '', fileName, newName);
          Logger.log(`MOVED + RENAMED: "${fileName}" -> "${newName}" -> ${destination}`);
        } else {
          Logger.log(`MOVED: "${fileName}" -> ${destination}`);
        }

        // Log to history
        historySheet.appendRow([
          today, fileName, newName || '', INBOX_FOLDER_NAME,
          destination, pillar, confidence, 'MOVED'
        ]);

        planSheet.getRange(i + 1, 9).setValue('DONE');

      } catch (err) {
        Logger.log(`ERROR moving "${fileName}": ${err.message}`);
        planSheet.getRange(i + 1, 9).setValue('ERROR');
        historySheet.appendRow([today, fileName, '', INBOX_FOLDER_NAME, destination, pillar, confidence, 'ERROR']);
        errorCount++;
      }
    }

    // All done — clean up
    props.deleteProperty('INBOX_EXEC_INDEX');
    clearInboxExecTriggers_();
    endRun_('INBOX_RUN_ID');

    Logger.log(`\nINBOX EXECUTE COMPLETE`);
    Logger.log(`Moved: ${movedCount} | Renamed: ${renamedCount} | Skipped: ${skippedCount} | Errors: ${errorCount}`);

  } catch (error) {
    Logger.log(`ERROR in executeInboxPlan: ${error.message}`);
    Logger.log(error.stack);
  }
}

/**
 * Sets up a weekly time-driven trigger for scanInbox().
 * Runs every Sunday at 7 AM in the script owner's timezone,
 * so results are ready for the Monday planning session.
 */
function setupWeeklyInboxScan() {
  // Remove any existing weekly triggers first
  removeWeeklyInboxScan();

  ScriptApp.newTrigger('scanInbox')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(7)
    .create();

  Logger.log('Weekly inbox scan scheduled: every Sunday at 7 AM.');
  SpreadsheetApp.getUi().alert('Weekly inbox scan scheduled for every Sunday at 7 AM.\n\nDrop files in the TO_ORGANIZE folder any time during the week.\nReview the INBOX_PLAN sheet during your weekly planning session.\nYou can edit the Destination column before approving if the AI got it wrong.');
}

/**
 * Removes the weekly inbox scan trigger.
 */
function removeWeeklyInboxScan() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scanInbox' && trigger.getTriggerSource() === ScriptApp.TriggerSource.CLOCK) {
      // Only remove weekly triggers, not auto-resume triggers
      const evType = trigger.getEventType();
      if (evType === ScriptApp.EventType.CLOCK) {
        ScriptApp.deleteTrigger(trigger);
      }
    }
  }
  Logger.log('Weekly inbox scan trigger removed.');
}

/**
 * Clears auto-resume triggers for inbox scan.
 */
function clearInboxScanTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'scanInbox') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * Clears auto-resume triggers for inbox execute.
 */
function clearInboxExecTriggers_() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'executeInboxPlan') {
      ScriptApp.deleteTrigger(trigger);
    }
  }
}

/**
 * Resets inbox scan state if stuck.
 */
function resetInbox() {
  const props = PropertiesService.getUserProperties();
  props.deleteProperty('INBOX_SCAN_INDEX');
  props.deleteProperty('INBOX_EXEC_INDEX');
  clearInboxScanTriggers_();
  clearInboxExecTriggers_();
  Logger.log('Inbox state cleared. You can now re-run scanInbox().');
}


// ============================================================================
// SECTION 13: MENU
// ============================================================================

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Drive Organizer');

  // Setup
  menu.addItem('Setup: Set API Key', 'setupApiKey');
  menu.addItem('Setup: Set Root Folder', 'setupRootFolder');
  menu.addItem('Setup: Set Sub-Folder Threshold', 'setupThreshold');
  menu.addItem('Setup: Set Age Cutoff', 'setupAgeCutoff');
  menu.addItem('Setup: Toggle Test Mode', 'toggleTestMode');
  menu.addSeparator();

  // Pass 1
  menu.addItem('Pass 1: Full Inventory Scan', 'pass1FullScan');
  menu.addItem('Pass 1: Reset Scan (if stuck)', 'resetPass1');
  menu.addSeparator();

  // Pass 2
  menu.addItem('Pass 2A: Classify Folders (AI)', 'pass2aClassifyFolders');
  menu.addItem('Pass 2B: Classify Files (AI)', 'pass2aClassify');
  menu.addItem('Pass 2C: Build Organization Plan', 'pass2bBuildPlan');
  menu.addSeparator();

  // Pass 3
  menu.addItem('Pass 3: Execute Structure Changes', 'pass3Execute');
  menu.addSeparator();

  // Pass 4
  menu.addItem('Pass 4: Rename - Dry Run', 'pass4RenameDryRun');
  menu.addItem('Pass 4: Rename - Execute (Mode A)', 'pass4RenameExecute');
  menu.addItem('Pass 4: Apply Approved Renames (Mode B)', 'applyApprovedRenames');
  menu.addItem('Pass 4: Reset (if stuck)', 'resetPass4');
  menu.addSeparator();

  // Cleanup
  menu.addItem('Scan: Find Duplicates', 'scanDuplicates');
  menu.addItem('Scan: Move Approved Duplicates', 'executeDuplicateMoves');
  menu.addItem('Scan: Flag Empty Folders', 'flagEmptyFolders');
  menu.addSeparator();

  // Inbox
  menu.addItem('Inbox: Scan TO_ORGANIZE', 'scanInbox');
  menu.addItem('Inbox: Execute Approved Moves', 'executeInboxPlan');
  menu.addItem('Inbox: Setup Weekly Scan', 'setupWeeklyInboxScan');
  menu.addItem('Inbox: Remove Weekly Scan', 'removeWeeklyInboxScan');
  menu.addItem('Inbox: Reset (if stuck)', 'resetInbox');
  menu.addSeparator();

  // Utilities
  menu.addItem('Report: Build Run Summary', 'buildRunSummary');
  menu.addItem('Undo Last Run', 'undoLastRun');
  menu.addItem('Reset All', 'resetAll');

  menu.addToUi();
}
