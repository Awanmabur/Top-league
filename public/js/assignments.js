(() => {
  const $ = (id) => document.getElementById(id);
  const BASE = "/admin/assignments";

  function readJson(id, fallback) {
    const el = $(id);
    if (!el) return fallback;
    try { return JSON.parse(el.value || el.textContent || JSON.stringify(fallback)); }
    catch (err) { console.error("Failed to parse JSON:", id, err); return fallback; }
  }

  const assignments = readJson("assignmentsData", []);
  if (!$('tbodyAssignments')) return;
  const state = { selected: new Set(), currentId: assignments[0]?.id || null };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };

  function icon(name) {
    const i = el('i', `fa-solid ${name}`);
    return i;
  }

  function button(className, title, iconName, action) {
    const b = el('button', className);
    b.type = 'button';
    b.title = title;
    b.dataset.action = action;
    b.appendChild(icon(iconName));
    return b;
  }

  function statusPill(status) {
    const map = {
      published: ['pill ok', 'fa-eye', 'Published'],
      archived: ['pill bad', 'fa-box-archive', 'Archived'],
      closed: ['pill info', 'fa-lock', 'Closed'],
      draft: ['pill warn', 'fa-pen-to-square', 'Draft'],
    };
    const [cls, iconName, text] = map[status] || map.draft;
    const span = el('span', cls);
    span.append(icon(iconName), document.createTextNode(` ${text}`));
    return span;
  }

  function openModal(id) {
    const modal = $(id); if (!modal) return;
    modal.classList.add('show'); document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    const modal = $(id); if (!modal) return;
    modal.classList.remove('show');
    if (!document.querySelector('.modal-backdrop.show')) document.body.style.overflow = '';
  }
  function findItem(id) { return assignments.find((a) => a.id === id) || null; }

  function addTextCell(row, className, value) {
    const td = el('td', className); const span = el('span', 'cell-ellipsis', value || '-'); td.appendChild(span); row.appendChild(td);
  }

  function renderTable() {
    const tbody = $('tbodyAssignments');
    const frag = document.createDocumentFragment();
    if (!assignments.length) {
      const tr = el('tr'); const td = el('td', '', 'No assignments found.'); td.colSpan = 11; td.style.padding = '18px'; tr.appendChild(td); frag.appendChild(tr);
    }
    assignments.forEach((a) => {
      const tr = el('tr', 'row-clickable'); tr.dataset.id = a.id;
      const checkTd = el('td', 'col-check'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.className = 'rowCheck'; checkbox.dataset.id = a.id; checkbox.checked = state.selected.has(a.id); checkTd.appendChild(checkbox); tr.appendChild(checkTd);
      const assignmentTd = el('td', 'col-assignment'); const main = el('div', 'item-main'); const title = el('div', 'item-title', a.title || '-'); title.title = a.title || '-'; main.append(title, el('div', 'item-sub', (a.instructions || '').slice(0, 90) || 'No instructions')); assignmentTd.appendChild(main); tr.appendChild(assignmentTd);
      addTextCell(tr, 'col-subject', a.courseName);
      addTextCell(tr, 'col-class', a.className);
      addTextCell(tr, 'col-section', a.sectionName || 'Whole Class');
      addTextCell(tr, 'col-stream', a.streamName || 'All Streams');
      addTextCell(tr, 'col-due', a.dueDisplay || '-');
      addTextCell(tr, 'col-points', String(a.totalPoints ?? 100));
      const submissionTd = el('td', 'col-submissions'); submissionTd.appendChild(el('span', 'cell-ellipsis', `${a.submittedCount || 0} submitted / ${a.gradedCount || 0} graded`)); tr.appendChild(submissionTd);
      const statusTd = el('td', 'col-status'); statusTd.appendChild(statusPill(a.status)); tr.appendChild(statusTd);
      const actionsTd = el('td', 'col-actions'); const actions = el('div', 'actions');
      actions.appendChild(button('btn-xs', 'View', 'fa-eye', 'view'));
      actions.appendChild(button('btn-xs', 'Submissions', 'fa-list-check', 'submissions'));
      if (!['closed','archived'].includes(a.status)) actions.appendChild(button('btn-xs', 'Edit', 'fa-pen', 'edit'));
      if (a.status === 'draft') actions.appendChild(button('btn-xs', 'Publish', 'fa-eye', 'publish'));
      if (a.status === 'published') {
        if (!(a.submissionCount > 0)) actions.appendChild(button('btn-xs', 'Return to Draft', 'fa-eye-slash', 'unpublish'));
        actions.appendChild(button('btn-xs', 'Close', 'fa-lock', 'close'));
      }
      if (a.status === 'closed') actions.appendChild(button('btn-xs', 'Reopen', 'fa-lock-open', 'reopen'));
      if (['draft','closed'].includes(a.status)) actions.appendChild(button('btn-xs', 'Archive', 'fa-box-archive', 'archive'));
      if (a.status === 'draft' && !(a.submissionCount > 0)) actions.appendChild(button('btn-xs', 'Delete', 'fa-trash', 'delete'));
      actionsTd.appendChild(actions); tr.appendChild(actionsTd); frag.appendChild(tr);
    });
    tbody.replaceChildren(frag);
    $('checkAll').checked = assignments.length > 0 && assignments.every((a) => state.selected.has(a.id));
    $('selCount').textContent = String(state.selected.size); $('bulkbar').classList.toggle('show', state.selected.size > 0);
  }

  function refreshAcademicSelector() { window.AcademicSelector?.refresh(document); }
  function applyAcademicSelection(item) {
    refreshAcademicSelector(); $('mClassGroup').value = item?.classId || ''; refreshAcademicSelector(); $('mSection').value = item?.sectionId || ''; $('mStream').value = item?.streamId || ''; $('mCourse').value = item?.courseId || ''; refreshAcademicSelector();
  }
  function fillHiddenAttachments(values) {
    const wrap = $('mAttachWrap'); if (!wrap) return; wrap.replaceChildren();
    values.forEach((value) => { const input = document.createElement('input'); input.type = 'hidden'; input.name = 'attachments[]'; input.value = value; wrap.appendChild(input); });
  }
  function openEditor(item, statusOverride) {
    const editing = !!item;
    $('mTitleBar').textContent = editing ? 'Edit Assignment' : 'Add Assignment'; $('assignForm').action = editing ? `${BASE}/${encodeURIComponent(item.id)}` : BASE;
    $('mTitle').value = item?.title || ''; $('mDue').value = item?.dueInput || ''; $('mPoints').value = String(item?.totalPoints ?? 100); $('mInstr').value = item?.instructions || ''; $('mRubric').value = item?.rubric || ''; $('mAttach').value = Array.isArray(item?.attachments) ? item.attachments.join('\n') : ''; $('mLate').checked = !!item?.allowLateSubmissions;
    $('mStatus').disabled = editing; $('mStatus').value = editing ? (['draft','published'].includes(item.status) ? item.status : 'draft') : (statusOverride || 'draft'); $('mStatusHelp').textContent = editing ? `Current status: ${item.status}. Use lifecycle actions after saving.` : 'New assignments may be saved as Draft or Published.';
    fillHiddenAttachments([]); applyAcademicSelection(item); openModal('mEdit');
  }
  function openView(item) {
    state.currentId = item.id;
    $('vTitle').textContent = item.title || '-'; $('vCourse').textContent = item.courseName || '-'; $('vClass').textContent = item.className || '-'; $('vSection').textContent = item.sectionName || 'Whole Class'; $('vStream').textContent = item.streamName || 'All Streams'; $('vDue').textContent = item.dueDisplay || '-'; $('vPoints').textContent = String(item.totalPoints ?? 100); $('vStatus').replaceChildren(statusPill(item.status)); $('vInstr').textContent = item.instructions || '-'; $('vRubric').textContent = item.rubric || '-'; $('vAttach').textContent = Array.isArray(item.attachments) && item.attachments.length ? item.attachments.join('\n') : '-'; $('vSubmissions').textContent = `${item.submittedCount || 0} submitted, ${item.gradedCount || 0} graded`;
    $('viewEditBtn').disabled = ['closed','archived'].includes(item.status); openModal('mView');
  }
  function submitAction(url, message) { if (message && !window.confirm(message)) return; const form = $('rowActionForm'); form.action = url; form.submit(); }
  function saveAssignment() {
    if (!$('mTitle').value.trim()) return window.alert('Title is required.'); if (!$('mCourse').value.trim()) return window.alert('Subject is required.');
    const attachments = $('mAttach').value.split(/\r?\n/).map((v) => v.trim()).filter(Boolean).slice(0, 30); fillHiddenAttachments(attachments); $('assignForm').submit();
  }
  function submitBulk(action) {
    const ids = [...state.selected]; if (!ids.length) return window.alert('Select at least one assignment.'); if (!window.confirm(`Apply ${action} to ${ids.length} assignment(s)?`)) return; $('bulkActionField').value = action; $('bulkIdsField').value = ids.join(','); $('bulkForm').submit();
  }

  $('btnCreate').addEventListener('click', () => openEditor()); $('quickDraft').addEventListener('click', () => openEditor(null, 'draft')); $('quickPublished').addEventListener('click', () => openEditor(null, 'published')); $('btnImport').addEventListener('click', () => openModal('mImport')); $('btnPrint').addEventListener('click', () => window.print()); $('saveBtn').addEventListener('click', saveAssignment); $('btnBulk').addEventListener('click', () => { if (!state.selected.size) return window.alert('Select at least one assignment.'); $('bulkbar').classList.add('show'); });
  $('bulkPublish').addEventListener('click', () => submitBulk('publish')); $('bulkUnpublish').addEventListener('click', () => submitBulk('unpublish')); $('bulkClose').addEventListener('click', () => submitBulk('close')); $('bulkReopen').addEventListener('click', () => submitBulk('reopen')); $('bulkArchive').addEventListener('click', () => submitBulk('archive')); $('bulkClear').addEventListener('click', () => { state.selected.clear(); renderTable(); });
  $('checkAll').addEventListener('change', (event) => { if (event.target.checked) assignments.forEach((a) => state.selected.add(a.id)); else state.selected.clear(); renderTable(); });
  $('tbodyAssignments').addEventListener('change', (event) => { if (!event.target.classList.contains('rowCheck')) return; const id = event.target.dataset.id; if (event.target.checked) state.selected.add(id); else state.selected.delete(id); renderTable(); });
  $('tbodyAssignments').addEventListener('click', (event) => {
    if (event.target.closest('.rowCheck')) return; const row = event.target.closest('tr[data-id]'); if (!row) return; const item = findItem(row.dataset.id); if (!item) return; const action = event.target.closest('button[data-action]')?.dataset.action;
    if (!action) return openView(item); if (action === 'view') return openView(item); if (action === 'edit') return openEditor(item); if (action === 'submissions') { window.location.assign(`${BASE}/${encodeURIComponent(item.id)}/submissions`); return; }
    const labels = {publish:'Publish',unpublish:'Return to Draft',close:'Close',reopen:'Reopen',archive:'Archive',delete:'Delete'}; if (labels[action]) return submitAction(`${BASE}/${encodeURIComponent(item.id)}/${action}`, `${labels[action]} this assignment?`);
  });
  $('viewEditBtn').addEventListener('click', () => { const item = findItem(state.currentId); if (!item || ['closed','archived'].includes(item.status)) return; closeModal('mView'); openEditor(item); });
  $('viewSubmissionsBtn').addEventListener('click', () => { const item = findItem(state.currentId); if (item) window.location.assign(`${BASE}/${encodeURIComponent(item.id)}/submissions`); });
  document.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
  ['mEdit','mView','mImport'].forEach((id) => { const modal = $(id); if (modal) modal.addEventListener('click', (event) => { if (event.target.id === id) closeModal(id); }); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { document.querySelectorAll('.modal-backdrop.show').forEach((node) => node.classList.remove('show')); document.body.style.overflow = ''; } });
  renderTable();
})();
