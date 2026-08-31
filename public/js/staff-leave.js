(function () {
  const $ = (id) => document.getElementById(id);
  const dataEl = $('leaveData');
  if (!dataEl || !$('tbody')) return;
  let DATA = [];
  try { DATA = JSON.parse(dataEl.value || '[]'); } catch (err) { console.error('Failed to parse leave data:', err); }
  const selected = new Set();

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = String(text);
    return node;
  };
  const icon = (name) => { const i = el('i', `fa-solid ${name}`); i.setAttribute('aria-hidden', 'true'); return i; };
  const button = (className, title, iconName) => {
    const b = el('button', `btn-xs ${className}`); b.type = 'button'; b.title = title; b.appendChild(icon(iconName)); return b;
  };
  const openModal = (id) => $(id)?.classList.add('show');
  const closeModal = (id) => $(id)?.classList.remove('show');

  function submitRowAction(url, fields = {}) {
    const form = $('rowActionForm');
    if (!form) return;
    form.action = url;
    form.querySelectorAll('.dyn').forEach((node) => node.remove());
    Object.entries(fields).forEach(([key, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = key; input.value = value; input.className = 'dyn'; form.appendChild(input);
    });
    form.submit();
  }

  function statusPill(status) {
    const config = {
      Approved: ['pill ok', 'fa-check'], Pending: ['pill warn', 'fa-clock'],
      Rejected: ['pill bad', 'fa-ban'], Cancelled: ['pill info', 'fa-xmark'],
    }[status] || ['pill info', 'fa-circle-info'];
    const span = el('span', config[0]); span.append(icon(config[1]), document.createTextNode(` ${status || '—'}`)); return span;
  }

  function syncBulkbar() {
    $('selCount').textContent = String(selected.size);
    $('bulkbar').classList.toggle('show', selected.size > 0);
  }

  function render() {
    $('resultMeta').textContent = `${DATA.length} leave request(s)`;
    $('checkAll').checked = DATA.length > 0 && DATA.every((x) => selected.has(x.id));
    const body = $('tbody'); body.replaceChildren();
    if (!DATA.length) {
      const tr = el('tr'); const td = el('td'); td.colSpan = 9; td.style.padding = '18px'; td.appendChild(el('div', 'muted', 'No leave requests found.')); tr.appendChild(td); body.appendChild(tr); syncBulkbar(); return;
    }
    DATA.forEach((x) => {
      const tr = el('tr'); tr.dataset.id = x.id;
      const selectTd = el('td'); const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'rowCheck'; check.dataset.id = x.id; check.checked = selected.has(x.id); selectTd.appendChild(check);
      const staffTd = el('td'); staffTd.append(el('div', 'strong', x.staffName || '—'), el('div', 'muted', `${x.employeeId || '—'} • ${x.departmentName || '—'}`));
      const typeTd = el('td'); const type = el('span', 'pill info'); type.append(icon('fa-tag'), document.createTextNode(` ${x.leaveType || '—'}`)); typeTd.appendChild(type);
      const datesTd = el('td'); datesTd.appendChild(el('div', 'strong', `${x.startDate || '—'} → ${x.endDate || '—'}`));
      const daysTd = el('td'); const days = el('span', 'pill info'); days.append(icon('fa-calendar-days'), document.createTextNode(` ${Number(x.days || 0)}`)); daysTd.appendChild(days);
      const statusTd = el('td'); statusTd.appendChild(statusPill(x.status));
      const reasonTd = el('td'); reasonTd.appendChild(el('div', 'muted', x.reason || '—'));
      const updatedTd = el('td', 'muted', x.updatedAt || '—');
      const actionsTd = el('td'); const actions = el('div', 'actions');
      actions.appendChild(button('actView', 'View', 'fa-eye'));
      if (x.canEdit) actions.appendChild(button('actEdit', 'Edit', 'fa-pen'));
      if (x.canApprove) actions.appendChild(button('actApprove', 'Approve', 'fa-check'));
      if (x.canReject) actions.appendChild(button('actReject', 'Reject', 'fa-ban'));
      if (x.canCancel) actions.appendChild(button('actCancel', 'Cancel', 'fa-xmark'));
      if (x.canDelete) actions.appendChild(button('actDelete', 'Delete', 'fa-trash'));
      actionsTd.appendChild(actions);
      tr.append(selectTd, staffTd, typeTd, datesTd, daysTd, statusTd, reasonTd, updatedTd, actionsTd);
      body.appendChild(tr);
    });
    syncBulkbar();
  }

  function resetForm() {
    $('mTitle').textContent = 'New Leave Request'; $('leaveForm').action = '/admin/staff-leave';
    $('lStaffId').disabled = false; $('lStaffId').value = ''; $('lLeaveType').value = 'Annual'; $('lStartDate').value = ''; $('lEndDate').value = ''; $('lDays').value = 0; $('lReason').value = '';
  }
  function calcDays() {
    const start = $('lStartDate').value, end = $('lEndDate').value;
    if (!start || !end) return void ($('lDays').value = 0);
    const diff = Math.floor((new Date(`${end}T00:00:00Z`) - new Date(`${start}T00:00:00Z`)) / 86400000);
    $('lDays').value = diff >= 0 ? diff + 1 : 0;
  }
  function openEditor(x) {
    if (!x) resetForm();
    else {
      $('mTitle').textContent = 'Edit Leave Request'; $('leaveForm').action = `/admin/staff-leave/${x.id}/update`;
      $('lStaffId').value = x.staffId || ''; $('lStaffId').disabled = true;
      $('lLeaveType').value = x.leaveType || 'Annual'; $('lStartDate').value = x.startDate || ''; $('lEndDate').value = x.endDate || ''; $('lDays').value = x.days || 0; $('lReason').value = x.reason || '';
    }
    openModal('mEdit');
  }
  function openView(x) {
    [['vStaff',x.staffName],['vEmployeeId',x.employeeId],['vDepartment',x.departmentName],['vLeaveType',x.leaveType],['vStartDate',x.startDate],['vEndDate',x.endDate],['vDays',x.days],['vStatus',x.status],['vReason',x.reason],['vRejectionReason',x.rejectionReason]].forEach(([id,value]) => { $(id).textContent = value || '—'; });
    openModal('mView');
  }
  function bulkSubmit(action) {
    if (!selected.size) return;
    $('bulkIds').value = Array.from(selected).join(','); $('bulkActionInput').value = action;
    if (action === 'reject') {
      const reason = window.prompt('Reason for rejecting the selected pending requests:');
      if (reason === null) return;
      if (!reason.trim()) return window.alert('A rejection reason is required.');
      $('bulkRejectionReason').value = reason.trim();
    } else $('bulkRejectionReason').value = '';
    $('bulkForm').submit();
  }

  $('btnCreate')?.addEventListener('click', () => openEditor(null));
  $('quickAnnual')?.addEventListener('click', () => { resetForm(); $('lLeaveType').value = 'Annual'; openModal('mEdit'); });
  $('quickSick')?.addEventListener('click', () => { resetForm(); $('lLeaveType').value = 'Sick'; openModal('mEdit'); });
  $('lStartDate')?.addEventListener('change', calcDays); $('lEndDate')?.addEventListener('change', calcDays);
  $('checkAll')?.addEventListener('change', (event) => { if (event.target.checked) DATA.forEach((x) => selected.add(x.id)); else selected.clear(); render(); });
  $('tbody').addEventListener('change', (event) => { if (!event.target.classList.contains('rowCheck')) return; event.target.checked ? selected.add(event.target.dataset.id) : selected.delete(event.target.dataset.id); syncBulkbar(); });
  $('tbody').addEventListener('click', (event) => {
    const tr = event.target.closest('tr[data-id]'); if (!tr) return; const x = DATA.find((row) => row.id === tr.dataset.id); if (!x) return;
    if (event.target.closest('.actView')) return openView(x);
    if (event.target.closest('.actEdit')) return openEditor(x);
    if (event.target.closest('.actApprove')) return submitRowAction(`/admin/staff-leave/${x.id}/approve`);
    if (event.target.closest('.actReject')) { const reason = window.prompt('Reason for rejection:', x.rejectionReason || ''); if (reason !== null && reason.trim()) submitRowAction(`/admin/staff-leave/${x.id}/reject`, { rejectionReason: reason.trim() }); return; }
    if (event.target.closest('.actCancel') && window.confirm(`Cancel leave request for "${x.staffName || 'staff'}"?`)) return submitRowAction(`/admin/staff-leave/${x.id}/cancel`);
    if (event.target.closest('.actDelete') && window.confirm(`Delete this cancelled/rejected leave request for "${x.staffName || 'staff'}"?`)) return submitRowAction(`/admin/staff-leave/${x.id}/delete`);
  });
  $('btnBulk')?.addEventListener('click', () => { if (!selected.size) window.alert('Select at least one leave request.'); else $('bulkbar').classList.add('show'); });
  $('bulkApprove')?.addEventListener('click', () => bulkSubmit('approve')); $('bulkReject')?.addEventListener('click', () => bulkSubmit('reject')); $('bulkCancel')?.addEventListener('click', () => bulkSubmit('cancel')); $('bulkDelete')?.addEventListener('click', () => bulkSubmit('delete')); $('bulkClear')?.addEventListener('click', () => { selected.clear(); render(); });
  document.querySelectorAll('[data-close-modal]').forEach((node) => node.addEventListener('click', () => closeModal(node.dataset.closeModal)));
  document.querySelectorAll('.modal-backdrop').forEach((node) => node.addEventListener('click', (event) => { if (event.target === node) closeModal(node.id); }));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop.show').forEach((node) => closeModal(node.id)); });
  render();
})();
