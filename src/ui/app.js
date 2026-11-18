const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const localDate = (offset = 0) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const readableDate = value => { if (!value) return '收集箱'; if (value === localDate()) return '今天'; if (value === localDate(1)) return '明天'; const [, m, d] = value.split('-'); return `${+m}月${+d}日`; };
const timeText = value => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const localTimeInput = value => { if (!value) return ''; const d = new Date(value); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; };
let state = { tasks: [], events: [], settings: {} }, view = 'today', day = localDate(), search = '', filter = 'all', selectedId = null;
let multi = false, selection = new Set(), drafts = new Map(), scheduleId, focusId, toastTimer, refreshTicket = 0, lastDay = localDate(), completing = false;
let sessionRestored = false;
window.captureSessionState = () => ({ captureDay:lastDay,view,day,search,filter,selectedId,multi,selection:[...selection],drafts:[...drafts],quickTitle:$('#quick-title').value,quickDate:$('#quick-date').value,scroll:$('#content').scrollTop,detailScroll:$('#detail').scrollTop,storage:Object.fromEntries(Object.keys(sessionStorage).map(key=>[key,sessionStorage.getItem(key)])) });
const priorityNames = { normal: '普通', important: '重要', urgent: '紧急' };
async function api(action, data) { const result = await window.planner.invoke(action, data); if (!result.ok) throw Error(result.error); return result.data; }
function toast(message, undo) {
 clearTimeout(toastTimer); const box = $('#toast'); box.replaceChildren(document.createTextNode(message)); box.hidden = false;
 if (undo) { const b = document.createElement('button'); b.textContent = '撤销'; b.onclick = () => run(async () => { const result = await api('undoSchedule', undo); await refresh(); for (const item of undo) { const draft = drafts.get(item.id); const restored = state.tasks.find(t => t.id === item.id); if (draft && restored) draft.plannedDate = restored.plannedDate || ''; } if (selectedId && undo.some(item => item.id === selectedId)) openDetail(selectedId); toast(result?.focusSkipped?.length ? '日期已恢复；重点名额已用满，保留当前的 3 项重点。' : '已恢复原来的安排'); }); box.append(b); }
 toastTimer = setTimeout(() => box.hidden = true, undo ? 9000 : 4200);
}
async function run(fn) { try { await fn(); } catch (error) { toast(error.message); } }
async function refresh() {
 const ticket = ++refreshTicket; const next = await api('snapshot'); if (ticket !== refreshTicket) return;
 state = next;
 const saved = !sessionRestored && next.session;
 sessionRestored=true;
 if(saved){view=saved.view;day=saved.day<localDate()?localDate():saved.day;search=saved.search;filter=saved.filter;selectedId=saved.selectedId;multi=saved.multi;selection=new Set(saved.selection);drafts=new Map(saved.drafts);$('#quick-title').value=saved.quickTitle;$('#quick-date').value=saved.captureDay && saved.captureDay!==localDate() && saved.quickDate===saved.captureDay ? localDate() : saved.quickDate;$('#search').value=search;$('#priority-filter').value=filter;for(const [key,value] of Object.entries(saved.storage||{}))sessionStorage.setItem(key,value);window.MemoryView?.restoreSession?.();}
 render();
 if(saved){if(selectedId)openDetail(selectedId);$('#content').scrollTop=saved.scroll||0;$('#detail').scrollTop=saved.detailScroll||0;await api('session:restored');}
 if(next.requestedTaskId){openDetail(next.requestedTaskId);await api('task:ack',next.requestedTaskId);}
}
function setView(next) {
 view = next; search = ''; filter = 'all'; $('#search').value = ''; $('#priority-filter').value = 'all'; selection.clear(); multi = false;
 if (next === 'future' && day < localDate()) day = localDate();
 $('#quick-date').value = next === 'inbox' ? '' : next === 'future' ? day : localDate();
 selectedId = null; $('#detail').hidden = true; render(); $('#content').scrollTop = 0;
}
function render() {
 document.body.dataset.page=view;
 const today = localDate(), todos = state.tasks.filter(t => t.status === 'todo'), todays = state.tasks.filter(t => t.plannedDate === today);
 const complete = todays.filter(t => t.status === 'done').length;
 $('#count-today').textContent = todos.filter(t => t.plannedDate === today).length;
 $('#count-inbox').textContent = todos.filter(t => !t.plannedDate).length;
 $('#count-memory').textContent = state.knowledge?.length||0;
 const unread = state.events.filter(e => !e.readAt).length;
 $('#count-events').textContent = unread || ''; $('#unread-dot').hidden = !unread;
 document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('active', el.dataset.view === view));
 $('#maximize').textContent = state.maximized ? '❐' : '□'; $('#maximize').setAttribute('aria-label', state.maximized ? '还原窗口' : '最大化');
 const titles = { today: '我的今天', inbox: '收集箱', future: '接下来 7 天', done: '已完成', settings: '设置', events: '提醒记录', memory:'记背' };
 $('#page-title').innerHTML = `${titles[view]}<span class="heading-dot">.</span>`;
 const dateLabel = new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
 const subtitles = { today: dateLabel, inbox: '', future: '', done: '', settings: '', events: '', memory:'' };
 $('#subtitle').textContent = subtitles[view]; $('#subtitle').hidden = !subtitles[view];
 $('#today-banner').hidden = view !== 'today'; $('#task-tools').hidden = ['settings', 'events','memory'].includes(view);
 $('#progress-text').textContent = `待办 ${todays.length-complete} · 已完成 ${complete}`;
 $('#quick-title').placeholder = view === 'inbox' ? '先记下来，之后再安排…' : view === 'future' ? `想在${readableDate(day)}做些什么…` : '记一件今天要做的事…';
 $('#week-strip').hidden = view !== 'future';
 if (view === 'future') renderWeek();
 $('#batch-bar').hidden = !multi; $('#multi-toggle').textContent = multi ? '取消多选' : '多选'; $('#batch-count').textContent = `已选 ${selection.size} 项`;
 if(view==='memory'){if(!$('#memory-container'))$('#content').innerHTML='<div id="memory-container"></div>';window.MemoryView.render({container:$('#memory-container'),state,api,refresh,toast});} else if (view === 'settings') renderSettings(); else if (view === 'events') renderEvents(); else renderTasks();
 if (selectedId && !state.tasks.some(t => t.id === selectedId)) { selectedId = null; $('#detail').hidden = true; }
}
function renderWeek() {
 if (innerWidth < 760) { $('#week-strip').innerHTML = `<label class="compact-day-label">安排哪一天<select id="week-select" aria-label="选择安排日期">${Array.from({length:7},(_,i)=>{const date=localDate(i),count=state.tasks.filter(t=>t.plannedDate===date&&t.status==='todo').length;return `<option value="${date}" ${day===date?'selected':''}>${readableDate(date)} · ${count} 项待办</option>`;}).join('')}</select></label>`; return; }
 $('#week-strip').innerHTML = Array.from({ length: 7 }, (_, i) => {
  const date = localDate(i), d = new Date(`${date}T12:00:00`), count = state.tasks.filter(t => t.plannedDate === date && t.status === 'todo').length;
  return `<button class="day-button ${date === day ? 'selected' : ''}" data-day="${date}" aria-label="${readableDate(date)}，${count}项待办"><span>${i === 0 ? '今天' : d.toLocaleDateString('zh-CN', { weekday: 'short' })}</span><b>${d.getDate()}</b><small>${count ? count + ' 件事' : '0 项待办'}</small></button>`;
 }).join('');
}
function matching(task) { return task.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (filter === 'all' || task.priority === filter); }
function sorted(tasks) { const weight = { urgent: 2, important: 1, normal: 0 }; return [...tasks].sort((a, b) => weight[b.priority] - weight[a.priority] || a.createdAt.localeCompare(b.createdAt)); }
function taskRow(task, assign = false) {
 const focus = task.focusDate === localDate(), done = task.status === 'done';
 const reminder = task.reminderAt ? `<span title="提醒时间">♧ ${escapeHtml(timeText(task.reminderAt))}</span>` : '';
 return `<article class="task-row ${focus ? 'is-focus' : ''} ${done ? 'is-done' : ''}" data-task="${task.id}">
 ${multi ? `<input type="checkbox" class="select-task" data-select="${task.id}" ${selection.has(task.id) ? 'checked' : ''} aria-label="选择 ${escapeHtml(task.title)}">` : ''}
 <button class="check-button" data-complete="${task.id}" aria-label="${done ? '取消完成' : '完成'} ${escapeHtml(task.title)}">${done ? '✓' : ''}</button>
 <button class="task-main" data-detail="${task.id}" aria-label="编辑 ${escapeHtml(task.title)}"><span class="task-title">${escapeHtml(task.title)}</span><span class="task-meta">${task.priority !== 'normal' ? `<span class="priority-${task.priority}">${priorityNames[task.priority]}</span>` : ''}${reminder}${task.notes ? '<span>有备注</span>' : ''}${done && task.completedAt ? `<span>完成于 ${escapeHtml(timeText(task.completedAt))}</span>` : ''}</span></button>
 <div class="task-actions">${assign ? `<button class="plan-assign" data-assign="${task.id}">安排</button>` : `<button class="task-date" data-date="${task.id}" title="安排日期">${readableDate(task.plannedDate)}</button>`}${!done && task.plannedDate === localDate() ? `<button class="star-button ${focus ? 'on' : ''}" data-focus="${task.id}" title="${focus ? '取消今日重点' : '设为今日重点'}" aria-label="${focus ? '取消今日重点' : '设为今日重点'}">${focus ? '★' : '☆'}</button>` : ''}</div></article>`;
}
function group(title, tasks, options = {}) {
 if (!tasks.length && !options.empty) return '';
 const header = `<span>${title}</span><small>${tasks.length}${options.limit ? ' / 3' : ''}</small><span class="line"></span>`;
 const rows = tasks.length ? sorted(tasks).map(t => taskRow(t, options.assign)).join('') : `<div class="group-empty">${options.empty}</div>`;
 return options.collapse ? `<details><summary class="group-heading">${header}</summary>${rows}</details>` : `<section><h2 class="group-heading">${header}</h2>${rows}</section>`;
}
function emptyState(title, text, action = 'add') {
 return `<div class="empty-state"><h3>${title}</h3><p>${text}</p><div class="empty-actions">${action === 'clear' ? '<button class="secondary-button" data-empty="clear">清除搜索与筛选</button>' : action === 'add' ? '<button class="secondary-button" data-empty="add">＋ 新增任务</button><button class="text-button" data-view="inbox">从收集箱安排 →</button>' : ''}</div></div>`;
}
function renderTasks() {
 const today = localDate(), tasks = state.tasks.filter(matching), todo = tasks.filter(t => t.status === 'todo'); let html = '';
 if (view === 'today') {
  const focus = todo.filter(t => t.plannedDate === today && t.focusDate === today), normal = todo.filter(t => t.plannedDate === today && t.focusDate !== today), overdue = todo.filter(t => t.plannedDate && t.plannedDate < today), done = tasks.filter(t => t.plannedDate === today && t.status === 'done');
  html = group('✦ 今日重点', focus, { limit: true }) + group('待办清单', normal) + group('待重新安排', overdue) + group('已完成', done, { collapse: true });
  if (!html) html = search || filter !== 'all' ? emptyState('没有找到这件事', '试着换一个关键词，或清除筛选。', 'clear') : emptyState('今天还没有安排', '新增任务，或从收集箱安排。');
  if (!normal.length && !focus.length && done.length && !search) html = `<div class="group-empty">✓ 今日任务已完成</div>` + html;
 } else if (view === 'inbox') {
  html = group('尚未安排', todo.filter(t => !t.plannedDate));
  if (!html) html = emptyState(search || filter !== 'all' ? '没有找到这件事' : '收集箱为空', '新增尚未安排日期的任务。', search || filter !== 'all' ? 'clear' : 'add');
 } else if (view === 'future') {
  html = '<div class="planning-columns">' + group(`${readableDate(day)}的安排`, todo.filter(t => t.plannedDate === day), { empty: '这一天暂无任务。' });
  html += group('从收集箱安排', todo.filter(t => !t.plannedDate), { assign: true, empty: '没有待安排的任务。' }) + '</div>';
  const farther = todo.filter(t => t.plannedDate > localDate(6));
  html += group('更远的安排', farther, { collapse: true });
 } else {
  html = group('已完成', tasks.filter(t => t.status === 'done'));
  if (!html) html = emptyState('暂无已完成任务', '完成的任务会显示在这里。', search || filter !== 'all' ? 'clear' : 'none');
 }
 $('#content').innerHTML = html;
}
function renderSettings() {
 const s = state.settings;
 const setting = (key, title, note) => `<div class="settings-row"><div><h3>${title}</h3><p>${note}</p></div><input class="toggle" type="checkbox" data-setting="${key}" aria-label="${title}" ${s[key] ? 'checked' : ''}></div>`;
 $('#content').innerHTML = `${state.petError?'<p class="error-message">桌宠进程已停止。请关闭再打开“显示桌宠”开关恢复；计划与提醒仍正常运行。</p>':''}<h2 class="settings-section">桌宠与提醒</h2><div class="settings-card">${setting('petVisible','显示桌宠','点击芽芽打开计划，拖动可以挪位置。')}${setting('petAlwaysOnTop','桌宠保持在最上层','不主动抢焦点，随时都找得到。')}${setting('doNotDisturb','免打扰','不弹出系统通知，提醒仍会保存在记录中。')}</div>
 <h2 class="settings-section">启动方式</h2><div class="settings-card"><div class="settings-row"><div><h3>开机自启</h3><p>登录 Windows 后启动芽芽，只显示桌宠和托盘。<br>计划窗口不会自动弹出；桌宠显隐沿用你的设置。</p><p class="error-message">${escapeHtml(state.startup?.migrationError||state.startup?.note||'')}</p></div><input class="toggle" id="startup-toggle" type="checkbox" aria-label="开机自启" ${state.startup?.enabled?'checked':''} ${state.startup?.supported?'':'disabled'}></div></div><h2 class="settings-section">数据与备份</h2><div class="settings-card"><div class="settings-row"><div><h3>离线使用，只保存在这台电脑</h3><p>不需要账号，也不会上传你的计划。</p></div></div><div class="settings-actions"><button class="secondary-button" data-action="export">导出备份</button><button class="secondary-button" data-action="import">恢复备份</button><button class="text-button" data-action="openDataFolder">打开数据目录</button></div></div>
 <h2 class="settings-section">提醒与入口</h2><div class="settings-card"><div class="settings-row"><div><h3>系统通知${state.notificationSupported && !state.notificationFailed ? '功能已支持' : '暂不可用'}</h3><p>${state.notificationFailed ? '系统通知发送失败，请检查 Windows 通知设置。' : '实际弹出受 Windows 通知权限与专注设置影响。'}<br>${escapeHtml(state.notificationStatus)}<br>即使没有弹窗，仍可在提醒记录中查看。</p></div><div><button class="text-button" data-action="notification:test">发送测试提醒</button><button class="text-button" data-view="events">查看记录</button></div></div><div class="settings-row"><div><h3>关闭窗口 ≠ 退出应用</h3><p>窗口关闭后，点击桌宠或系统托盘即可回来。<br>完全退出后不再提醒，再启动会检查错过的计划。</p></div></div></div><button class="danger-button" data-action="quit">退出芽芽计划</button><p class="muted">芽芽计划 0.4.1</p>`;
}
function renderEvents() {
 const events = [...state.events].sort((a,b) => b.createdAt.localeCompare(a.createdAt));
 $('#content').innerHTML = events.length ? `<button class="text-button" data-action="readEvents">全部标为已读</button>${events.map(e => `<article class="event-row"><h3>${e.readAt ? '' : '• '}${escapeHtml(e.title)}</h3><p>${escapeHtml(timeText(e.createdAt))}</p>${state.tasks.some(t => t.id === e.taskId) ? `<button class="text-button" data-detail="${e.taskId}">查看任务 →</button>` : ''}</article>`).join('')}` : emptyState('这里暂时很安静', '给任务设置提醒，到时间芽芽会记得。', 'none');
}
function openDetail(id) {
 const task = state.tasks.find(t => t.id === id); if (!task) return; selectedId = id;
 const draft = drafts.get(id) || { title: task.title, notes: task.notes, plannedDate: task.plannedDate || '', priority: task.priority, reminderAt: localTimeInput(task.reminderAt) };
 $('#detail').innerHTML = `<div class="detail-head"><span>给这件事，一点具体的安排</span><button id="detail-close" aria-label="关闭详情">×</button></div><form id="detail-form"><label class="field">想做什么<textarea class="title-edit" name="title" maxlength="200" required aria-label="任务标题">${escapeHtml(draft.title)}</textarea></label><label class="field">安排在哪一天<input name="plannedDate" type="date" value="${escapeHtml(draft.plannedDate)}"></label><label class="field">优先级<select name="priority">${Object.entries(priorityNames).map(([key,label]) => `<option value="${key}" ${draft.priority === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field">到时提醒我<input name="reminderAt" type="datetime-local" value="${escapeHtml(draft.reminderAt)}"></label><p class="muted">提醒不会随计划日期自动移动。清空时间可取消提醒。</p><label class="field">备注<textarea name="notes" maxlength="10000" placeholder="补充步骤、想法，或给自己的提示…">${escapeHtml(draft.notes)}</textarea></label><div id="detail-error" class="error-message" role="alert"></div><button class="primary-button full" type="submit">保存修改</button></form><div class="detail-buttons"><button class="secondary-button" data-complete="${id}">${task.status === 'done' ? '取消完成' : '标记完成'}</button><button class="text-button" id="detail-cancel">放弃修改</button></div><button class="danger-button" data-delete="${id}">删除这项任务</button><div class="detail-status">创建于 ${escapeHtml(timeText(task.createdAt))}<br>已保存的计划会一直留在这台电脑。</div>`;
 $('#detail').hidden = false;
 $('#detail-form').addEventListener('input', () => drafts.set(id, Object.fromEntries(new FormData($('#detail-form')))));
 $('#detail-form').addEventListener('submit', async e => {
  e.preventDefault(); const form = $('#detail-form'), values = Object.fromEntries(new FormData(form)), submit = form.querySelector('[type=submit]');
  submit.disabled = true; $('#detail-error').textContent = '';
  try { const iso = values.reminderAt ? new Date(values.reminderAt).toISOString() : null; const original = state.tasks.find(t => t.id === id); const patch = { ...values, plannedDate: values.plannedDate || null, reminderAt: values.reminderAt === localTimeInput(original.reminderAt) ? original.reminderAt : iso }; await api('update', { id, patch }); drafts.delete(id); await refresh(); openDetail(id); toast('修改已保存'); }
  catch (error) { $('#detail-error').textContent = error.message; submit.disabled = false; }
 });
 $('#detail-close').onclick = () => { selectedId = null; $('#detail').hidden = true; };
 $('#detail-cancel').onclick = () => run(async () => { if (!drafts.has(id) || await api('confirmDiscard')) { drafts.delete(id); selectedId = null; $('#detail').hidden = true; } });
}
function openSchedule(id) {
 const task = state.tasks.find(t => t.id === id); scheduleId = id;
 $('#schedule-task-title').textContent = task.title; $('#schedule-date').value = task.plannedDate || localDate();
 $('#schedule-reminder').textContent = task.reminderAt ? `提醒仍为 ${timeText(task.reminderAt)}。如需改提醒，请到任务详情修改。` : '只安排日期，不会自动添加提醒。';
 $('#schedule-dialog').showModal();
}
async function schedule(ids, date) {
 if (!ids.length) { toast('先选择要安排的任务'); return; }
 const undo = await api('schedule', { ids, date });
 for (const id of ids) { const draft = drafts.get(id); if (draft) draft.plannedDate = date || ''; }
 selection.clear(); await refresh(); if (selectedId && ids.includes(selectedId)) openDetail(selectedId);
 toast(`已将 ${ids.length} 件事${date ? '安排到' + readableDate(date) : '放回收集箱'}，提醒时间保持不变`, undo);
}
async function toggleFocus(id) {
 const task = state.tasks.find(t => t.id === id), focuses = state.tasks.filter(t => t.focusDate === localDate() && t.status === 'todo');
 if (task.focusDate !== localDate() && focuses.length >= 3) { focusId = id; $('#focus-options').innerHTML = focuses.map(t => `<button class="focus-option" data-replace="${t.id}">替换：${escapeHtml(t.title)}</button>`).join(''); $('#focus-dialog').showModal(); return; }
 await api('focus', { id }); await refresh();
}
document.addEventListener('click', e => run(async () => {
 const button = e.target.closest('button'); if (!button) return;
 const d = button.dataset;
 if (d.view) setView(d.view);
 if (d.detail) openDetail(d.detail);
 if (d.complete) { const t = state.tasks.find(t => t.id === d.complete); button.disabled = true; completing = true; try { await api('update', { id: t.id, patch: { status: t.status === 'done' ? 'todo' : 'done' } }); if(t.status !== 'done') { button.closest('.task-row')?.classList.add('is-done'); if(button.classList.contains('check-button')) button.textContent = '✓'; await new Promise(resolve => setTimeout(resolve, 180)); } await refresh(); if (selectedId === t.id) openDetail(t.id); } finally { button.disabled = false; completing = false; } }
 if (d.delete) { if (await api('delete', { id: d.delete })) { drafts.delete(d.delete); await refresh(); toast('任务已删除'); } }
 if (d.date) openSchedule(d.date);
 if (d.focus) await toggleFocus(d.focus);
 if (d.assign) await schedule([d.assign], day);
 if (d.day) { day = d.day; $('#quick-date').value = day; render(); }
 if (d.schedule) { await schedule([scheduleId], d.schedule === 'inbox' ? null : localDate(d.schedule === 'tomorrow' ? 1 : 0)); $('#schedule-dialog').close(); }
 if (d.batch) await schedule([...selection], d.batch === 'inbox' ? null : localDate(d.batch === 'tomorrow' ? 1 : 0));
 if (d.replace) { await api('focus', { id: focusId, replaceId: d.replace }); $('#focus-dialog').close(); await refresh(); }
 if (d.empty === 'add') $('#quick-title').focus();
 if (d.empty === 'clear') { search = ''; filter = 'all'; $('#search').value = ''; $('#priority-filter').value = 'all'; render(); }
 if (d.action) { const result = await api(d.action); if (d.action === 'export' && result) toast('备份已导出'); if (d.action === 'import' && result) { drafts.clear(); selectedId=null; $('#detail').hidden=true; window.MemoryView.resetAfterRestore(); toast('备份已恢复'); } await refresh(); }
}));
document.addEventListener('change', e => run(async () => {
 if(e.target.id==='startup-toggle'){const enabled=e.target.checked;e.target.disabled=true;try{await api('startup:set',{enabled});toast(enabled?'已开启开机自启':'已关闭开机自启');}finally{await refresh();}return;}
 if (e.target.id === 'week-select') { day = e.target.value; $('#quick-date').value = day; render(); }
 if (e.target.dataset.select) { e.target.checked ? selection.add(e.target.dataset.select) : selection.delete(e.target.dataset.select); $('#batch-count').textContent = `已选 ${selection.size} 项`; }
 if (e.target.dataset.setting) { await api('settings', { [e.target.dataset.setting]: e.target.checked }); await refresh(); }
}));
$('#quick-form').addEventListener('submit', e => run(async () => {
 e.preventDefault(); if (composing) return;
 const title = $('#quick-title').value; if (!title.trim()) { toast('先写下这件事的名字'); $('#quick-title').focus(); return; }
 $('#quick-add').disabled = true;
 try { await api('add', { title, plannedDate: $('#quick-date').value || null }); $('#quick-title').value = ''; await refresh(); $('#quick-title').focus(); }
 finally { $('#quick-add').disabled = false; }
}));
let composing = false;
$('#quick-title').addEventListener('compositionstart', () => composing = true);
$('#quick-title').addEventListener('compositionend', () => composing = false);
$('#quick-title').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.isComposing || e.keyCode === 229)) e.preventDefault(); });
$('#quick-inbox').onclick = () => { $('#quick-date').value = ''; $('#quick-title').focus(); };
$('#search').addEventListener('input', e => { search = e.target.value; renderTasks(); });
$('#priority-filter').onchange = e => { filter = e.target.value; renderTasks(); };
$('#multi-toggle').onclick = () => { multi = !multi; selection.clear(); render(); };
$('#batch-apply').onclick = () => run(() => $('#batch-date').value ? schedule([...selection], $('#batch-date').value) : toast('请先选择日期'));
$('#schedule-apply').onclick = () => run(async () => { if (!$('#schedule-date').value) { toast('请选择日期'); return; } await schedule([scheduleId], $('#schedule-date').value); $('#schedule-dialog').close(); });
$('#focus-cancel').onclick = () => $('#focus-dialog').close();
$('#notifications').onclick = () => setView('events');
for (const [id, action] of [['minimize','minimize'],['maximize','maximize'],['hide','hide']]) $('#' + id).onclick = () => run(() => api(action));
document.addEventListener('keydown', e => {
 if (e.isComposing) return;
 if (e.ctrlKey && e.key.toLowerCase() === 'n') { e.preventDefault(); if(view==='memory'){window.MemoryView.focusNew();return;} if (['settings','events'].includes(view)) setView('today'); $('#quick-title').focus(); }
 if (e.ctrlKey && e.key.toLowerCase() === 'f') { e.preventDefault(); if(view==='memory'){window.MemoryView.focusSearch();return;} if (['settings','events'].includes(view)) setView('today'); $('#search').focus(); }
 if (e.key === 'Escape' && selectedId && !document.querySelector('dialog[open]')) $('#detail-cancel').click();
});
window.planner.onChange(() => { if(!completing) run(refresh); }); window.planner.onOpenTask(id => run(async () => { await refresh(); openDetail(id); }));
setInterval(() => { if (lastDay !== localDate()) { const previous = lastDay; lastDay = localDate(); if ($('#quick-date').value === previous) $('#quick-date').value = lastDay; if (day < lastDay) day = lastDay; run(refresh); } }, 15000);
$('#quick-date').value = localDate(); run(refresh);
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer=setTimeout(()=>{if(view==='future')renderWeek();},100); });
