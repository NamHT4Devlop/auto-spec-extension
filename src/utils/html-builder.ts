/**
 * html-builder.ts
 * Renders a structured EpicOutput object into a self-contained, professional HTML file.
 * No external CDN required — all CSS/JS is inlined.
 */

// ─── Data Types ───────────────────────────────────────────────────────────────

export interface AcceptanceCriterion {
  given: string;
  when: string;
  then: string;
}

export interface UserStory {
  id: string;               // "US-001"
  featureId: string;        // "F1"
  title: string;
  role: string;             // "Customer", "Admin"...
  action: string;           // "place an order"
  benefit: string;          // "so that I can track my progress"
  priority: 'P1' | 'P2' | 'P3';
  storyPoints: number;
  sprint: number;
  acceptanceCriteria: AcceptanceCriterion[];
  definitionOfDone: string[];
  dependencies: string[];
  technicalNotes: string;
  apiEndpoints: string[];
  affectedModules: string[];
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  stories: UserStory[];
}

export interface EpicOutput {
  epic: {
    title: string;
    description: string;
    businessValue: string;
    totalStories: number;
    totalPoints: number;
    estimatedSprints: number;
  };
  features: Feature[];
  systemFindings: string;
  assumptions: string[];
  outOfScope: string[];
  generatedAt: string;
  projectName: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function priorityClass(p: string): string {
  return p === 'P1' ? 'p1' : p === 'P2' ? 'p2' : 'p3';
}

function priorityLabel(p: string): string {
  return p === 'P1' ? '🔴 P1 Critical' : p === 'P2' ? '🟡 P2 High' : '🔵 P3 Normal';
}

function sprintColor(n: number): string {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#3b82f6'];
  return colors[(n - 1) % colors.length];
}

// ─── Sub-renderers ────────────────────────────────────────────────────────────

function renderStoryCard(s: UserStory): string {
  const acList = s.acceptanceCriteria.map((ac, i) => `
    <div class="ac-item" id="ac-${esc(s.id)}-${i}">
      <div class="ac-badge">AC${i + 1}</div>
      <div class="ac-body">
        <span class="ac-label given">Given</span> ${esc(ac.given)}<br>
        <span class="ac-label when">When</span> ${esc(ac.when)}<br>
        <span class="ac-label then">Then</span> ${esc(ac.then)}
      </div>
    </div>`).join('');

  const dodList = s.definitionOfDone.map(d =>
    `<li><label><input type="checkbox"> ${esc(d)}</label></li>`
  ).join('');

  const depBadges = s.dependencies.map(d =>
    `<span class="dep-badge" onclick="focusStory('${esc(d)}')">${esc(d)}</span>`
  ).join('');

  const apiList = s.apiEndpoints.map(a => `<code>${esc(a)}</code>`).join(' ');
  const modList = s.affectedModules.map(m => `<span class="module-badge">${esc(m)}</span>`).join('');

  return `
<div class="story-card ${priorityClass(s.priority)}" id="story-${esc(s.id)}"
     data-priority="${esc(s.priority)}" data-sprint="${s.sprint}"
     data-feature="${esc(s.featureId)}" data-role="${esc(s.role)}">
  <div class="story-header" onclick="toggleStory('${esc(s.id)}')">
    <div class="story-meta">
      <span class="story-id">${esc(s.id)}</span>
      <span class="priority-badge ${priorityClass(s.priority)}">${priorityLabel(s.priority)}</span>
      <span class="sprint-badge" style="background:${sprintColor(s.sprint)}">Sprint ${s.sprint}</span>
      <span class="points-badge">⭐ ${s.storyPoints} pts</span>
    </div>
    <h3 class="story-title">${esc(s.title)}</h3>
    <div class="story-sentence">
      <em>As <strong>${esc(s.role)}</strong>, I want to <strong>${esc(s.action)}</strong>
      so that <strong>${esc(s.benefit)}</strong>.</em>
    </div>
    <div class="story-quick">
      <span class="quick-stat">📋 ${s.acceptanceCriteria.length} ACs</span>
      <span class="quick-stat">✅ ${s.definitionOfDone.length} DoD</span>
      ${s.dependencies.length ? `<span class="quick-stat">🔗 ${s.dependencies.length} deps</span>` : ''}
      <span class="expand-icon">▼</span>
    </div>
  </div>
  <div class="story-detail" id="detail-${esc(s.id)}" style="display:none">
    ${acList ? `<div class="detail-section">
      <h4>📋 Acceptance Criteria</h4>
      <div class="ac-list">${acList}</div>
    </div>` : ''}
    ${dodList ? `<div class="detail-section">
      <h4>✅ Definition of Done</h4>
      <ul class="dod-list">${dodList}</ul>
    </div>` : ''}
    ${s.dependencies.length ? `<div class="detail-section">
      <h4>🔗 Dependencies</h4>
      <div class="dep-list">${depBadges}</div>
    </div>` : ''}
    ${s.technicalNotes ? `<div class="detail-section">
      <h4>🔧 Technical Notes</h4>
      <p class="tech-notes">${esc(s.technicalNotes)}</p>
    </div>` : ''}
    ${s.apiEndpoints.length ? `<div class="detail-section">
      <h4>🌐 API Endpoints</h4>
      <div class="api-list">${apiList}</div>
    </div>` : ''}
    ${s.affectedModules.length ? `<div class="detail-section">
      <h4>📦 Affected Modules</h4>
      <div class="module-list">${modList}</div>
    </div>` : ''}
  </div>
</div>`;
}

function renderFeatureSection(f: Feature): string {
  const cards = f.stories.map(renderStoryCard).join('');
  const totalPts = f.stories.reduce((acc, s) => acc + s.storyPoints, 0);
  return `
<div class="feature-section" id="feature-${esc(f.id)}" data-feature="${esc(f.id)}">
  <div class="feature-header">
    <div class="feature-id">${esc(f.id)}</div>
    <div class="feature-info">
      <h2 class="feature-title">${esc(f.title)}</h2>
      <p class="feature-desc">${esc(f.description)}</p>
    </div>
    <div class="feature-stats">
      <span class="fstat">📖 ${f.stories.length} stories</span>
      <span class="fstat">⭐ ${totalPts} pts</span>
    </div>
  </div>
  <div class="stories-grid">${cards}</div>
</div>`;
}

function renderSprintView(data: EpicOutput): string {
  const allStories = data.features.flatMap(f => f.stories);
  const maxSprint = Math.max(...allStories.map(s => s.sprint), 1);
  const columns = Array.from({ length: maxSprint }, (_, i) => {
    const sprintNum = i + 1;
    const stories = allStories.filter(s => s.sprint === sprintNum);
    const pts = stories.reduce((a, s) => a + s.storyPoints, 0);
    const cards = stories.map(s => `
      <div class="sprint-card ${priorityClass(s.priority)}" onclick="focusStory('${esc(s.id)}')">
        <div class="sprint-card-id">${esc(s.id)}</div>
        <div class="sprint-card-title">${esc(s.title)}</div>
        <div class="sprint-card-meta">
          <span class="priority-dot ${priorityClass(s.priority)}"></span>
          ${esc(s.role)} · ${s.storyPoints}pts
        </div>
      </div>`).join('');
    return `
    <div class="sprint-column">
      <div class="sprint-col-header" style="border-top:3px solid ${sprintColor(sprintNum)}">
        <strong>Sprint ${sprintNum}</strong>
        <span class="sprint-meta">${stories.length} stories · ${pts} pts</span>
      </div>
      <div class="sprint-cards">${cards || '<p class="empty-sprint">No stories</p>'}</div>
    </div>`;
  }).join('');
  return `<div class="sprint-board">${columns}</div>`;
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export function buildUserStoriesHtml(data: EpicOutput): string {
  const allStories = data.features.flatMap(f => f.stories);
  const allRoles = [...new Set(allStories.map(s => s.role))];
  const maxSprint = Math.max(...allStories.map(s => s.sprint), 1);

  const featureSections = data.features.map(renderFeatureSection).join('');
  const sprintView = renderSprintView(data);

  const assumptionsList = data.assumptions.map(a => `<li>${esc(a)}</li>`).join('');
  const outOfScopeList = data.outOfScope.map(o => `<li>${esc(o)}</li>`).join('');

  const roleFilterOptions = allRoles.map(r =>
    `<option value="${esc(r)}">${esc(r)}</option>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(data.epic.title)} — User Stories</title>
<style>
/* ── Reset & base ── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
       background: #f1f5f9; color: #1e293b; line-height: 1.6; }
a { color: #6366f1; }
code { background: #e2e8f0; padding: 1px 5px; border-radius: 4px;
       font-family: 'Fira Code', monospace; font-size: 0.85em; }

/* ── Layout ── */
.app { max-width: 1400px; margin: 0 auto; padding: 0 16px 60px; }

/* ── Epic header ── */
.epic-hero { background: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%);
             color: white; padding: 40px 48px; border-radius: 0 0 24px 24px; margin-bottom: 32px;
             box-shadow: 0 8px 32px rgba(99,102,241,0.3); }
.epic-hero h1 { font-size: 2rem; font-weight: 700; margin-bottom: 8px; }
.epic-hero .epic-desc { font-size: 1.05rem; opacity: 0.85; margin-bottom: 20px; max-width: 800px; }
.epic-hero .business-value { background: rgba(255,255,255,0.12); border-left: 3px solid #a78bfa;
  padding: 12px 16px; border-radius: 8px; font-size: 0.9rem; margin-bottom: 24px; max-width: 800px; }
.epic-stats { display: flex; gap: 20px; flex-wrap: wrap; }
.epic-stat { background: rgba(255,255,255,0.15); border-radius: 10px; padding: 10px 20px;
             text-align: center; min-width: 100px; }
.epic-stat .val { font-size: 1.8rem; font-weight: 700; }
.epic-stat .lbl { font-size: 0.75rem; opacity: 0.75; text-transform: uppercase; letter-spacing: 0.05em; }
.epic-meta { margin-top: 20px; font-size: 0.8rem; opacity: 0.6; }

/* ── Toolbar ── */
.toolbar { background: white; border-radius: 12px; padding: 14px 20px; margin-bottom: 24px;
           box-shadow: 0 1px 4px rgba(0,0,0,0.08); display: flex; gap: 12px;
           align-items: center; flex-wrap: wrap; }
.tab-group { display: flex; gap: 4px; background: #f1f5f9; border-radius: 8px; padding: 3px; }
.tab { padding: 7px 16px; border-radius: 6px; cursor: pointer; font-size: 0.875rem;
       font-weight: 500; color: #64748b; border: none; background: transparent; transition: all 0.15s; }
.tab.active { background: white; color: #6366f1; box-shadow: 0 1px 4px rgba(0,0,0,0.12); }
.tab:hover:not(.active) { background: rgba(255,255,255,0.6); color: #475569; }
.filters { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
select, .search-box { padding: 7px 12px; border: 1px solid #e2e8f0; border-radius: 8px;
                      font-size: 0.875rem; outline: none; background: white; color: #1e293b;
                      cursor: pointer; }
select:focus, .search-box:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.15); }
.search-box { width: 200px; }
.btn-print { padding: 7px 16px; background: #6366f1; color: white; border: none;
             border-radius: 8px; cursor: pointer; font-size: 0.875rem; font-weight: 500; }
.btn-print:hover { background: #4f46e5; }

/* ── Feature sections ── */
.feature-section { background: white; border-radius: 16px; padding: 24px 28px;
                   margin-bottom: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.feature-header { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px;
                  padding-bottom: 16px; border-bottom: 2px solid #f1f5f9; }
.feature-id { background: #6366f1; color: white; font-weight: 700; padding: 6px 12px;
              border-radius: 8px; font-size: 0.875rem; flex-shrink: 0; height: fit-content; }
.feature-info { flex: 1; }
.feature-title { font-size: 1.2rem; font-weight: 600; color: #1e293b; margin-bottom: 4px; }
.feature-desc { color: #64748b; font-size: 0.9rem; }
.feature-stats { display: flex; gap: 8px; flex-direction: column; text-align: right; flex-shrink: 0; }
.fstat { color: #64748b; font-size: 0.85rem; font-weight: 500; }

/* ── Story grid ── */
.stories-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }

/* ── Story card ── */
.story-card { border: 2px solid #e2e8f0; border-radius: 12px; overflow: hidden;
              transition: box-shadow 0.2s, transform 0.1s; }
.story-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.1); transform: translateY(-1px); }
.story-card.p1 { border-left: 4px solid #ef4444; }
.story-card.p2 { border-left: 4px solid #f59e0b; }
.story-card.p3 { border-left: 4px solid #3b82f6; }
.story-card.hidden { display: none; }
.story-card.highlighted { box-shadow: 0 0 0 3px #6366f1, 0 4px 16px rgba(99,102,241,0.3); }

.story-header { padding: 16px; cursor: pointer; background: #fafafa; }
.story-header:hover { background: #f8fafc; }
.story-meta { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; align-items: center; }
.story-id { font-family: monospace; font-weight: 700; color: #475569; font-size: 0.9rem; }
.priority-badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 100px; font-weight: 600; }
.priority-badge.p1 { background: #fee2e2; color: #b91c1c; }
.priority-badge.p2 { background: #fef3c7; color: #92400e; }
.priority-badge.p3 { background: #dbeafe; color: #1d4ed8; }
.sprint-badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 100px; color: white;
                font-weight: 600; }
.points-badge { font-size: 0.72rem; padding: 2px 8px; border-radius: 100px;
                background: #f0fdf4; color: #166534; font-weight: 600; }
.story-title { font-size: 0.95rem; font-weight: 600; color: #1e293b; margin-bottom: 8px; }
.story-sentence { font-size: 0.85rem; color: #475569; font-style: italic; margin-bottom: 10px;
                  padding: 8px; background: #f8fafc; border-radius: 6px; }
.story-sentence strong { color: #1e293b; font-style: normal; }
.story-quick { display: flex; gap: 8px; align-items: center; }
.quick-stat { font-size: 0.78rem; color: #64748b; }
.expand-icon { margin-left: auto; color: #94a3b8; font-size: 0.75rem; transition: transform 0.2s; }
.expanded .expand-icon { transform: rotate(180deg); }

/* ── Story detail ── */
.story-detail { padding: 0 16px 16px; border-top: 1px solid #f1f5f9; background: white; }
.detail-section { margin-top: 14px; }
.detail-section h4 { font-size: 0.82rem; text-transform: uppercase; letter-spacing: 0.05em;
                     color: #64748b; margin-bottom: 8px; font-weight: 600; }
.ac-list { display: flex; flex-direction: column; gap: 8px; }
.ac-item { display: flex; gap: 10px; background: #f8fafc; border-radius: 8px;
           padding: 10px 12px; font-size: 0.83rem; }
.ac-badge { background: #6366f1; color: white; border-radius: 4px; padding: 1px 6px;
            font-size: 0.7rem; font-weight: 700; height: fit-content; flex-shrink: 0; }
.ac-body { color: #334155; line-height: 1.7; }
.ac-label { font-weight: 700; font-size: 0.72rem; text-transform: uppercase;
            letter-spacing: 0.04em; padding: 1px 5px; border-radius: 3px; }
.ac-label.given { background: #dbeafe; color: #1d4ed8; }
.ac-label.when  { background: #fef3c7; color: #92400e; }
.ac-label.then  { background: #dcfce7; color: #166534; }
.dod-list { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.dod-list li { display: flex; align-items: flex-start; gap: 8px; font-size: 0.85rem;
               color: #334155; }
.dod-list input[type="checkbox"] { margin-top: 3px; cursor: pointer; flex-shrink: 0; }
.dep-list, .module-list, .api-list { display: flex; gap: 6px; flex-wrap: wrap; }
.dep-badge { background: #ede9fe; color: #6d28d9; padding: 3px 10px; border-radius: 100px;
             font-size: 0.78rem; font-weight: 600; cursor: pointer; }
.dep-badge:hover { background: #c4b5fd; }
.module-badge { background: #f1f5f9; color: #475569; padding: 3px 10px; border-radius: 100px;
                font-size: 0.78rem; font-weight: 500; }
.tech-notes { font-size: 0.85rem; color: #475569; background: #fffbeb; border-left: 3px solid #f59e0b;
              padding: 10px 14px; border-radius: 6px; }

/* ── Sprint board ── */
.sprint-board { display: flex; gap: 16px; overflow-x: auto; padding: 4px 0 16px;
                min-height: 200px; }
.sprint-column { background: white; border-radius: 12px; min-width: 260px; flex: 1;
                 box-shadow: 0 1px 4px rgba(0,0,0,0.08); overflow: hidden; }
.sprint-col-header { padding: 14px 18px; border-bottom: 1px solid #f1f5f9; }
.sprint-col-header strong { font-size: 0.95rem; color: #1e293b; display: block; }
.sprint-meta { font-size: 0.78rem; color: #64748b; }
.sprint-cards { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.sprint-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 12px;
               cursor: pointer; transition: box-shadow 0.15s; }
.sprint-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
.sprint-card.p1 { border-left: 3px solid #ef4444; }
.sprint-card.p2 { border-left: 3px solid #f59e0b; }
.sprint-card.p3 { border-left: 3px solid #3b82f6; }
.sprint-card-id { font-family: monospace; font-size: 0.75rem; font-weight: 700; color: #94a3b8; }
.sprint-card-title { font-size: 0.85rem; font-weight: 600; color: #1e293b; margin: 2px 0 4px; }
.sprint-card-meta { font-size: 0.75rem; color: #64748b; display: flex; align-items: center; gap: 4px; }
.priority-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.priority-dot.p1 { background: #ef4444; }
.priority-dot.p2 { background: #f59e0b; }
.priority-dot.p3 { background: #3b82f6; }
.empty-sprint { color: #94a3b8; font-size: 0.85rem; font-style: italic; text-align: center; padding: 20px; }

/* ── Info panel (assumptions / out-of-scope) ── */
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 24px; }
.info-card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.info-card h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 12px; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
.info-card ul { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.info-card li { font-size: 0.85rem; color: #334155; padding-left: 16px; position: relative; }
.info-card li::before { content: '•'; position: absolute; left: 0; color: #6366f1; font-weight: 700; }
.system-findings { background: white; border-radius: 12px; padding: 20px; margin-bottom: 24px;
                   box-shadow: 0 1px 4px rgba(0,0,0,0.06); }
.system-findings h3 { font-size: 0.9rem; font-weight: 600; margin-bottom: 10px; color: #475569;
                      text-transform: uppercase; letter-spacing: 0.04em; }
.system-findings p { font-size: 0.88rem; color: #334155; white-space: pre-wrap; line-height: 1.8; }

/* ── View containers ── */
.view { display: none; }
.view.active { display: block; }

/* ── Empty state ── */
.empty-state { text-align: center; padding: 60px 20px; color: #94a3b8; font-size: 0.9rem; }

/* ── Print ── */
@media print {
  .toolbar, .btn-print { display: none !important; }
  .story-detail { display: block !important; }
  .story-card { break-inside: avoid; }
  body { background: white; }
  .epic-hero { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
</style>
</head>
<body>
<div class="app">

  <!-- Epic Hero -->
  <div class="epic-hero">
    <h1>📦 ${esc(data.epic.title)}</h1>
    <p class="epic-desc">${esc(data.epic.description)}</p>
    ${data.epic.businessValue ? `<div class="business-value">🎯 <strong>Business Value:</strong> ${esc(data.epic.businessValue)}</div>` : ''}
    <div class="epic-stats">
      <div class="epic-stat"><div class="val">${data.features.length}</div><div class="lbl">Features</div></div>
      <div class="epic-stat"><div class="val">${data.epic.totalStories}</div><div class="lbl">User Stories</div></div>
      <div class="epic-stat"><div class="val">${data.epic.totalPoints}</div><div class="lbl">Story Points</div></div>
      <div class="epic-stat"><div class="val">${data.epic.estimatedSprints}</div><div class="lbl">Sprints</div></div>
    </div>
    <div class="epic-meta">📅 Generated: ${esc(data.generatedAt)} · Project: ${esc(data.projectName)} · Auto Spec Kit</div>
  </div>

  <!-- Toolbar -->
  <div class="toolbar">
    <div class="tab-group">
      <button class="tab active" onclick="switchTab('stories')">📖 All Stories</button>
      <button class="tab" onclick="switchTab('sprint')">🗓 Sprint View</button>
      <button class="tab" onclick="switchTab('info')">ℹ️ Context</button>
    </div>
    <div class="filters">
      <input class="search-box" type="search" placeholder="🔍 Search stories..."
             oninput="filterStories()" id="search-box">
      <select onchange="filterStories()" id="filter-priority">
        <option value="">All Priorities</option>
        <option value="P1">🔴 P1 Critical</option>
        <option value="P2">🟡 P2 High</option>
        <option value="P3">🔵 P3 Normal</option>
      </select>
      <select onchange="filterStories()" id="filter-sprint">
        <option value="">All Sprints</option>
        ${Array.from({ length: maxSprint }, (_, i) =>
          `<option value="${i + 1}">Sprint ${i + 1}</option>`
        ).join('')}
      </select>
      <select onchange="filterStories()" id="filter-role">
        <option value="">All Roles</option>
        ${roleFilterOptions}
      </select>
    </div>
    <button class="btn-print" onclick="window.print()">🖨 Print</button>
  </div>

  <!-- Stories View -->
  <div id="view-stories" class="view active">${featureSections}</div>

  <!-- Sprint View -->
  <div id="view-sprint" class="view">${sprintView}</div>

  <!-- Context View -->
  <div id="view-info" class="view">
    ${data.systemFindings ? `<div class="system-findings">
      <h3>🔍 System Investigation Findings</h3>
      <p>${esc(data.systemFindings)}</p>
    </div>` : ''}
    <div class="info-grid">
      ${data.assumptions.length ? `<div class="info-card">
        <h3>💡 Assumptions</h3>
        <ul>${data.assumptions.map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      </div>` : ''}
      ${data.outOfScope.length ? `<div class="info-card">
        <h3>🚫 Out of Scope</h3>
        <ul>${data.outOfScope.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
      </div>` : ''}
    </div>
  </div>

</div><!-- end .app -->

<script>
// ── Tab switching ──
function switchTab(tab) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('view-' + tab).classList.add('active');
  event.target.classList.add('active');
}

// ── Story expand/collapse ──
function toggleStory(id) {
  const detail = document.getElementById('detail-' + id);
  const card   = document.getElementById('story-' + id);
  const isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  card.classList.toggle('expanded', !isOpen);
}

// ── Focus a story (e.g. from sprint board click or dep badge click) ──
function focusStory(id) {
  switchTab('stories');
  setTimeout(() => {
    document.querySelectorAll('.tab')[0].classList.add('active');
    const card = document.getElementById('story-' + id);
    if (!card) { return; }
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('highlighted');
    const detail = document.getElementById('detail-' + id);
    if (detail) { detail.style.display = 'block'; card.classList.add('expanded'); }
    setTimeout(() => card.classList.remove('highlighted'), 2500);
  }, 50);
}

// ── Filter stories ──
function filterStories() {
  const q  = document.getElementById('search-box').value.toLowerCase();
  const pr = document.getElementById('filter-priority').value;
  const sp = document.getElementById('filter-sprint').value;
  const ro = document.getElementById('filter-role').value;
  let visible = 0;
  document.querySelectorAll('.story-card').forEach(card => {
    const titleEl = card.querySelector('.story-title');
    const titleText = (titleEl ? titleEl.textContent : '').toLowerCase();
    const sentEl = card.querySelector('.story-sentence');
    const sentText = (sentEl ? sentEl.textContent : '').toLowerCase();
    const matchQ  = !q  || titleText.includes(q) || sentText.includes(q);
    const matchPr = !pr || card.dataset.priority === pr;
    const matchSp = !sp || card.dataset.sprint    === sp;
    const matchRo = !ro || card.dataset.role      === ro;
    const show    = matchQ && matchPr && matchSp && matchRo;
    card.classList.toggle('hidden', !show);
    if (show) { visible++; }
  });
  // Show/hide feature sections if all their stories are hidden
  document.querySelectorAll('.feature-section').forEach(sec => {
    const anyVisible = sec.querySelectorAll('.story-card:not(.hidden)').length > 0;
    sec.style.display = anyVisible ? '' : 'none';
  });
}

// ── Keyboard shortcut: Ctrl+P = print ──
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'p') { e.preventDefault(); window.print(); }
});
</script>
</body>
</html>`;
}
