/* Civil-day coordinates; the same task ID and inclusive range are used everywhere. */
(() => {
  'use strict';
  const DAY = 86400000, MAX_DAYS = 366;
  const FIRST = Date.parse('0001-01-01T00:00:00Z') / DAY;
  const LAST = Date.parse('9999-12-31T00:00:00Z') / DAY;
  const date = day => new Date(day * DAY).toISOString().slice(0, 10);
  const ordinal = value => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const day = Date.parse(`${value}T00:00:00Z`) / DAY;
    return Number.isInteger(day) && day >= FIRST && day <= LAST && date(day) === value ? day : null;
  };
  const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
  const weekday = ['日', '一', '二', '三', '四', '五', '六'];
  const node = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };
  const button = (text, cls, action, label = text) => {
    const el = node('button', cls, text); el.type = 'button';
    el.setAttribute('aria-label', label);
    if (action) el.addEventListener('click', action);
    return el;
  };
  const expected = task => ({ plannedDate: task.plannedDate ?? null,
    plannedEndDate: task.plannedEndDate || task.plannedDate || null, updatedAt: task.updatedAt });

  function render({ container, toolbarContainer, project, stages = [], tasks = [], session = {}, onTask = () => {},
    onStage = () => {}, onSchedule = () => {}, onTaskSchedule = async () => {}, onSessionChange = () => {} }) {
    if (!container || !project) return () => {};
    const phases = stages.filter(s => s.projectId === project.id).slice().sort((a, b) => (a.order || 0) - (b.order || 0));
    const entries = tasks.filter(t => t.projectId === project.id), groups = new Map(phases.map(s => [s.id, []])), ungrouped = [];
    entries.forEach(t => (groups.get(t.stageId) || ungrouped).push(t));
    const collapsed = new Set((Array.isArray(session.collapsed) ? session.collapsed : []).filter(id => groups.has(id)));
    session.collapsed = [...collapsed];
    session.density = session.density === 'compact' ? 'compact' : 'comfortable';
    if (!entries.some(t => t.id === session.selectedTaskId)) session.selectedTaskId = null;
    if (!entries.some(t => t.id === session.taskDraft?.id)) delete session.taskDraft;
    const now = new Date(), today = ordinal(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
    const target = ordinal(project.targetDate), dated = [today];
    phases.forEach(s => dated.push(ordinal(s.startDate), ordinal(s.endDate)));
    entries.forEach(t => dated.push(ordinal(t.plannedDate), ordinal(t.plannedEndDate || t.plannedDate)));
    const scheduled = dated.slice(1).filter(d => d !== null);
    const initialDay = scheduled.length ? clamp(today, Math.min(...scheduled), Math.max(...scheduled)) : today;
    if (target !== null) dated.push(target);
    const valid = dated.filter(d => d !== null);
    const domainStart = Math.max(FIRST, Math.min(...valid) - 3);
    const domainEnd = Math.min(LAST, Math.max(Math.max(...valid) + 3, domainStart + 27));
    const paged = domainEnd - domainStart + 1 > MAX_DAYS;
    let viewport, inspector, feedback, live, toolbar, currentStart, currentEnd, dayWidth;
    let drag = null, frame = 0, stopped = false, saving = false, suppressClick = false;
    const root = node('section', 'project-gantt'); root.setAttribute('aria-label', `${project.title}的每日甘特图`);
    container.replaceChildren(root);
    const notify = () => onSessionChange();
    const saveScroll = () => {
      if (!viewport || stopped) return;
      session.scrollLeft = viewport.scrollLeft; session.scrollTop = viewport.scrollTop; notify();
    };
    const message = (text, error = false) => {
      if (stopped) return;
      feedback.textContent = text; feedback.classList.toggle('is-error', error); feedback.hidden = !text;
      live.textContent = text;
    };
    const bounds = (item, kind) => kind === 'task'
      ? [ordinal(item.plannedDate), ordinal(item.plannedEndDate || item.plannedDate)]
      : [ordinal(item.startDate), ordinal(item.endDate)];
    function position(bar, start, end) {
      const left = Math.max(start, currentStart), right = Math.min(end, currentEnd);
      bar.style.left = `${(left - currentStart) * dayWidth + 3}px`;
      bar.style.width = `${Math.max(0, (right - left + 1) * dayWidth - 6)}px`;
      bar.classList.toggle('is-clipped-start', start < currentStart);
      bar.classList.toggle('is-clipped-end', end > currentEnd);
    }
    function cancelDrag(announce = false) {
      if (frame) cancelAnimationFrame(frame); frame = 0;
      if (!drag) return;
      const d = drag; drag = null;
      position(d.bar, d.start, d.end); d.bar.classList.remove('is-dragging');
      d.bar.querySelector('.gantt-drag-range')?.remove();
      if (d.control.hasPointerCapture?.(d.pointerId)) d.control.releasePointerCapture(d.pointerId);
      if (announce && d.active) message('已取消本次拖动');
    }
    function jumpTo(day) {
      cancelDrag();
      if (paged && (day < currentStart || day > currentEnd)) {
        session.rangeStart = date(clamp(day - 7, domainStart, domainEnd - MAX_DAYS + 1));
        session.scrollLeft = 0; draw();
      }
      viewport.scrollLeft = Math.max(0, (day - currentStart) * dayWidth - dayWidth * 2); saveScroll();
    }
    function markers(track) {
      for (let d = currentStart; d <= currentEnd; d++) {
        const week = new Date(d * DAY).getUTCDay();
        if (week !== 0 && week !== 6) continue;
        const shade = node('span', 'gantt-weekend'); shade.style.left = `${(d - currentStart) * dayWidth}px`;
        track.append(shade);
      }
    }
    function selectTask(task) {
      session.selectedTaskId = task.id;
      root.querySelectorAll('[data-task-id]').forEach(row => row.classList.toggle('is-selected', row.dataset.taskId === task.id));
      renderInspector(); notify();
    }
    function candidate(task, startDate, endDate) {
      return { id: task.id, startDate, endDate, expected: session.taskDraft?.id === task.id ? session.taskDraft.expected : expected(task) };
    }
    async function commitTask(task, proposal) {
      if (saving) return;
      const a = ordinal(proposal.startDate), b = ordinal(proposal.endDate);
      if ((proposal.startDate || proposal.endDate) && (a === null || b === null || b < a)) {
        message('请选择有效的起止日期，结束日不能早于开始日。', true); return;
      }
      const [oldStart, oldEnd] = bounds(task, 'task');
      if (a === oldStart && b === oldEnd) { delete session.taskDraft; renderInspector(); notify(); return; }
      saving = true; session.selectedTaskId = task.id;
      // Parent refreshes immediately after persistence; rejected writes restore the candidate.
      delete session.taskDraft; notify(); renderInspector(); message('正在保存日期…');
      try {
        await onTaskSchedule(proposal);
        if (!stopped) {
          task.plannedDate = proposal.startDate || null; task.plannedEndDate = proposal.endDate || null;
          saving = false; draw(); message('日期已保存');
        }
      } catch (error) {
        session.taskDraft = proposal; saving = false; notify();
        if (!stopped) { renderInspector(); message(`${error?.message || '日期未能保存'}；候选日期已保留，可重试。`, true); }
      }
    }
    function renderInspector() {
      if (!inspector) return;
      inspector.replaceChildren();
      const task = entries.find(t => t.id === session.selectedTaskId);
      inspector.hidden = !task;
      if (!task) return;
      const draft = session.taskDraft?.id === task.id ? session.taskDraft : null;
      const title = node('div', 'gantt-selection');
      const strong = node('strong', '', task.title); strong.title = task.title; title.append(strong);
      const [a, b] = draft ? [ordinal(draft.startDate), ordinal(draft.endDate)] : bounds(task, 'task');
      title.append(node('span', 'gantt-duration-readout', a === null || b === null ? '未安排日期' : `${b - a + 1} 天`));
      const fields = node('div', 'gantt-date-fields');
      const inputs = ['startDate', 'endDate'].map((key, i) => {
        const input = node('input'); input.type = 'date'; input.name = key; input.id = `gantt-task-${key}`;
        input.min = '0001-01-01'; input.max = '9999-12-31';
        input.value = (draft ? draft[key] : i ? task.plannedEndDate || task.plannedDate : task.plannedDate) || '';
        input.setAttribute('aria-label', `任务${i ? '结束' : '开始'}日`); input.disabled = saving;
        if (i) fields.append(node('span', '', '—')); fields.append(input); return input;
      });
      inputs.forEach(input => input.addEventListener('input', () => {
        session.taskDraft = candidate(task, inputs[0].value || null, inputs[1].value || null);
        const start = ordinal(inputs[0].value), end = ordinal(inputs[1].value);
        title.lastChild.textContent = start === null || end === null || end < start ? '待确认日期' : `${end - start + 1} 天`;
        notify();
      }));
      const apply = node('button', 'gantt-apply', saving ? '保存中' : draft ? '重试 / 应用' : '应用');
      apply.type = 'submit'; apply.disabled = saving;
      const details = button('详情', 'gantt-details', () => onTask(task.id), `打开${task.title}的完整详情`);
      inspector.append(title, fields, apply);
      if (draft) inspector.append(button('恢复已存', 'gantt-discard', () => {
        delete session.taskDraft; renderInspector(); notify(); message('已恢复最近保存的日期');
      }, '放弃候选日期，恢复最近保存的日期'));
      else inspector.append(details);
      inspector.onsubmit = event => {
        event.preventDefault(); void commitTask(task, candidate(task, inputs[0].value || null, inputs[1].value || null));
      };
    }
    function nextDates(start, end, mode, offset) {
      if (mode === 'start') return [clamp(start + offset, FIRST, end), end];
      if (mode === 'end') return [start, clamp(end + offset, start, LAST)];
      const shift = clamp(offset, FIRST - start, LAST - end); return [start + shift, end + shift];
    }
    function updateDrag() {
      if (!drag?.active) return;
      const d = drag, shift = Math.round((d.lastX - d.x + viewport.scrollLeft - d.scroll) / dayWidth);
      [d.nextStart, d.nextEnd] = nextDates(d.start, d.end, d.mode, shift);
      position(d.bar, d.nextStart, d.nextEnd); d.bar.classList.add('is-dragging');
      let label = d.bar.querySelector('.gantt-drag-range');
      if (!label) { label = node('span', 'gantt-drag-range'); d.bar.append(label); }
      const text = `${date(d.nextStart)}—${date(d.nextEnd)} · ${d.nextEnd - d.nextStart + 1} 天`;
      label.textContent = text; live.textContent = `${text}，Escape 取消`;
    }
    function autoScroll() {
      frame = 0;
      if (!drag?.active || stopped) return;
      const rect = viewport.getBoundingClientRect();
      const nameWidth = parseFloat(getComputedStyle(root).getPropertyValue('--gantt-name-width'));
      const left = rect.left + nameWidth, right = rect.right - 12, edge = Math.min(42, (right - left) / 3);
      const speed = drag.lastX < left + edge ? -Math.min(18, Math.max(0, (left + edge - drag.lastX) / 3))
        : drag.lastX > right - edge ? Math.min(18, Math.max(0, (drag.lastX - right + edge) / 3)) : 0;
      if (speed) { viewport.scrollLeft += speed; updateDrag(); }
      // Active drags only: no animation frame or timer remains after release/cancel.
      frame = requestAnimationFrame(autoScroll);
    }
    function controlEvents(control, bar, item, kind, mode, start, end) {
      control.addEventListener('click', event => {
        if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
        kind === 'task' ? selectTask(item) : onStage(item.id);
      });
      control.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || saving) return;
        event.preventDefault();
        const [a, b] = nextDates(start, end, mode, event.key === 'ArrowLeft' ? -1 : 1);
        if (a === start && b === end) return;
        if (kind === 'task') {
          selectTask(item); session.focusControl = { id: item.id, edge: mode };
          void commitTask(item, candidate(item, date(a), date(b)));
        }
        else onSchedule({ id: item.id, startDate: date(a), endDate: date(b) });
      });
      control.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary || saving) return;
        cancelDrag(); suppressClick = false;
        if (kind === 'task') selectTask(item);
        drag = { control, bar, item, kind, mode, start, end, nextStart: start, nextEnd: end,
          pointerId: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX,
          scroll: viewport.scrollLeft, active: false };
        control.setPointerCapture?.(event.pointerId);
      });
      control.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId || drag.control !== control) return;
        drag.lastX = event.clientX;
        if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 6) return;
        drag.active = true; suppressClick = true; updateDrag();
        if (!frame) frame = requestAnimationFrame(autoScroll);
      });
      control.addEventListener('pointerup', event => {
        if (!drag || drag.pointerId !== event.pointerId || drag.control !== control) return;
        const d = drag; cancelDrag();
        if (!d.active || (d.start === d.nextStart && d.end === d.nextEnd)) return;
        const proposal = { id: item.id, startDate: date(d.nextStart), endDate: date(d.nextEnd) };
        if (kind === 'task') void commitTask(item, candidate(item, proposal.startDate, proposal.endDate));
        else onSchedule(proposal);
      });
      control.addEventListener('pointercancel', () => cancelDrag(true));
      control.addEventListener('lostpointercapture', () => cancelDrag(true));
    }
    function dateJump(track, day, label) {
      track.append(button(`${day < currentStart ? '← ' : ''}${date(day)}${day > currentEnd ? ' →' : ''}`, 'gantt-outside',
        () => jumpTo(day), `定位${label} ${date(day)}`));
    }
    function rangeBar(track, item, kind) {
      const [start, end] = bounds(item, kind);
      if (start === null || end === null) {
        track.append(button('未安排日期', 'gantt-unscheduled', () => kind === 'task' ? selectTask(item) : onStage(item.id),
          `给${item.title}安排日期`)); return;
      }
      if (end < currentStart || start > currentEnd) { dateJump(track, start, item.title); return; }
      const bar = node('div', `gantt-bar gantt-${kind}-bar`); bar.dataset[`${kind}Bar`] = item.id;
      bar.title = `${item.title} · ${date(start)}—${date(end)} · ${end - start + 1} 天${item.status === 'done' ? ' · 已完成' : ''}`;
      position(bar, start, end);
      const isDone = kind === 'task' ? item.status === 'done' : groups.get(item.id)?.length && groups.get(item.id).every(t => t.status === 'done');
      bar.classList.toggle('is-done', Boolean(isDone));
      for (const mode of ['start', 'move', 'end']) {
        const label = `${item.title}，${date(start)}至${date(end)}，${mode === 'move' ? '整体平移' : `调整${mode === 'start' ? '开始' : '结束'}日`}；方向键按一天调整`;
        const control = button('', mode === 'move' ? 'gantt-bar-move' : `gantt-bar-handle gantt-bar-${mode}`, null, label);
        control.dataset.edge = mode;
        if (mode === 'move') control.append(node('span', 'gantt-bar-label', kind === 'task' ? `${isDone ? '✓ ' : ''}${end - start >= 2 ? item.title : ''}` : ''));
        if ((mode === 'start' && start < currentStart) || (mode === 'end' && end > currentEnd)) control.hidden = true;
        controlEvents(control, bar, item, kind, mode, start, end); bar.append(control);
      }
      track.append(bar);
    }
    function row(kind) {
      const row = node('div', `gantt-row gantt-${kind}-row`), name = node('div', 'gantt-name'), track = node('div', 'gantt-track');
      markers(track); row.append(name, track); return { row, name, track };
    }
    function taskRow(task, phase) {
      const r = row('task'), [a, b] = bounds(task, 'task'); r.row.dataset.taskId = task.id;
      r.row.classList.toggle('is-done', task.status === 'done'); r.row.classList.toggle('is-selected', session.selectedTaskId === task.id);
      const select = button('', 'gantt-name-button gantt-task-name', () => selectTask(task), `${task.title}，${task.status === 'done' ? '已完成' : '待办'}，选择任务日期`);
      select.append(node('span', 'gantt-task-state', task.status === 'done' ? '✓' : '○'), node('span', 'gantt-title', task.title));
      select.title = task.title; r.name.append(select, node('span', 'gantt-duration', a === null ? '未安排' : `${b - a + 1} 天`));
      if (phase?.startDate && a !== null && (a < ordinal(phase.startDate) || b > ordinal(phase.endDate))) {
        r.row.classList.add('is-outlier');
        const note = node('span', 'gantt-outlier-note', '范围外'); note.title = '任务日期在阶段范围外，可以保留或调整'; r.name.append(note);
      }
      rangeBar(r.track, task, 'task'); return r.row;
    }
    function stageRows(stage, rows) {
      const r = row('stage'), list = groups.get(stage.id), isCollapsed = collapsed.has(stage.id); r.row.dataset.stageId = stage.id;
      const toggle = button(isCollapsed ? '›' : '⌄', 'gantt-collapse', () => {
        saveScroll(); isCollapsed ? collapsed.delete(stage.id) : collapsed.add(stage.id); session.collapsed = [...collapsed]; draw(); notify();
        root.querySelector(`[data-stage-toggle="${CSS.escape(stage.id)}"]`)?.focus({ preventScroll: true });
      }, `${isCollapsed ? '展开' : '收起'}${stage.title}的任务`);
      toggle.dataset.stageToggle = stage.id; toggle.setAttribute('aria-expanded', String(!isCollapsed));
      const title = button(stage.title, 'gantt-name-button gantt-stage-name', () => onStage(stage.id), `编辑阶段：${stage.title}`);
      const count = list.length ? `${list.filter(t => t.status === 'done').length}/${list.length} 项` : '尚无任务';
      title.title = `${stage.title} · ${count}`; r.name.append(toggle, title, node('span', 'gantt-stage-count', count));
      rangeBar(r.track, stage, 'stage'); rows.append(r.row);
      if (!isCollapsed) list.forEach(task => rows.append(taskRow(task, stage)));
    }
    function calendar(rows) {
      const header = node('div', 'gantt-row gantt-header'), name = node('div', 'gantt-name gantt-name-heading');
      name.append(node('span', '', '阶段 / 任务'), node('span', 'gantt-duration', '天数'));
      const dates = node('div', 'gantt-calendar'), months = node('div', 'gantt-months'), days = node('div', 'gantt-dates');
      let month = null;
      for (let day = currentStart; day <= currentEnd; day++) {
        const value = date(day), d = new Date(day * DAY), dw = d.getUTCDay(), key = value.slice(0, 7);
        if (!month || month.dataset.month !== key) {
          month = node('div', 'gantt-month', `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月`);
          month.dataset.month = key; month.dataset.days = '0'; months.append(month);
        }
        month.dataset.days = String(Number(month.dataset.days) + 1); month.style.width = `${Number(month.dataset.days) * dayWidth}px`;
        const cell = node('div', `gantt-date-cell${dw === 0 || dw === 6 ? ' is-weekend' : ''}${day === today ? ' is-today' : ''}${day === target ? ' is-target' : ''}`);
        cell.dataset.date = value; cell.title = `${value}${day === today ? ' · 今天' : ''}${day === target ? ' · 目标日' : ''}`;
        cell.setAttribute('aria-label', cell.title);
        if (day === today) cell.setAttribute('aria-current', 'date');
        cell.append(node('span', '', String(d.getUTCDate())), node('small', '', day === today ? '今天' : day === target ? '目标' : `周${weekday[dw]}`)); days.append(cell);
      }
      dates.append(months, days); header.append(name, dates); rows.append(header);
    }
    function draw() {
      cancelDrag(); const top = Number(session.scrollTop) || 0;
      let left = Number(session.scrollLeft) || 0;
      root.replaceChildren();
      dayWidth = session.density === 'compact' ? 44 : 48;
      currentStart = paged ? clamp(ordinal(session.rangeStart) ?? Math.max(domainStart, initialDay - 7), domainStart, domainEnd - MAX_DAYS + 1) : domainStart;
      currentEnd = paged ? currentStart + MAX_DAYS - 1 : domainEnd;
      if (!Number.isFinite(session.scrollLeft)) left = Math.max(0, (initialDay - currentStart - (container.clientWidth > 500 ? 2 : 0)) * dayWidth);
      root.style.setProperty('--gantt-day', `${dayWidth}px`);
      root.style.setProperty('--gantt-timeline', `${(currentEnd - currentStart + 1) * dayWidth}px`);
      toolbar = node('div', 'gantt-toolbar');
      toolbar.append(node('span', 'gantt-caption', `${date(currentStart).slice(0, 7).replace('-', ' 年 ')} 月`));
      toolbar.append(button('今天', 'gantt-today-button', () => jumpTo(today), '回到今天'));
      if (target !== null) toolbar.append(button('目标日', 'gantt-target-button', () => jumpTo(target), `定位目标日 ${project.targetDate}`));
      const density = button(session.density === 'compact' ? '舒展' : '紧凑', 'gantt-density', () => {
        saveScroll(); const anchor = viewport.scrollLeft / dayWidth;
        session.density = session.density === 'compact' ? 'comfortable' : 'compact'; session.scrollLeft = anchor * (session.density === 'compact' ? 44 : 48);
        draw(); notify(); toolbar.querySelector('.gantt-density').focus({ preventScroll: true });
      });
      density.setAttribute('aria-pressed', String(session.density === 'compact')); toolbar.append(density);
      if (toolbarContainer) toolbarContainer.replaceChildren(toolbar); else root.append(toolbar);
      if (paged) {
        const nav = node('div', 'gantt-range-nav');
        const full = node('span', 'gantt-full-range', `${date(domainStart)}—${date(domainEnd)}`); full.title = `完整范围 ${full.textContent}`;
        const previous = button('←', 'gantt-range-button', () => jumpTo(Math.max(domainStart, currentStart - MAX_DAYS)), '前一段日期'); previous.disabled = currentStart <= domainStart;
        const next = button('→', 'gantt-range-button', () => jumpTo(Math.min(domainEnd, currentEnd + 1)), '后一段日期'); next.disabled = currentEnd >= domainEnd;
        const jump = node('input', 'gantt-range-date'); jump.type = 'date'; jump.min = date(domainStart); jump.max = date(domainEnd); jump.value = date(currentStart);
        jump.setAttribute('aria-label', '定位时间轴日期');
        jump.addEventListener('change', () => { const day = ordinal(jump.value); if (day !== null) jumpTo(clamp(day, domainStart, domainEnd)); });
        nav.append(full, previous, jump, next); root.append(nav);
      }
      viewport = node('div', 'gantt-viewport'); viewport.tabIndex = 0; viewport.setAttribute('role', 'region');
      viewport.setAttribute('aria-label', `每日甘特图，${date(currentStart)}至${date(currentEnd)}，可横向滚动`);
      const rows = node('div', 'gantt-rows'); calendar(rows); phases.forEach(stage => stageRows(stage, rows));
      if (ungrouped.length) {
        const section = row('section'); section.name.textContent = `未分阶段 · ${ungrouped.length} 项`; rows.append(section.row);
        ungrouped.forEach(task => rows.append(taskRow(task)));
      }
      if (!phases.length && !entries.length) { const empty = row('empty'); empty.name.textContent = '尚无阶段或任务'; rows.append(empty.row); }
      viewport.append(rows); root.append(viewport);
      inspector = node('form', 'gantt-inspector'); inspector.setAttribute('aria-label', '所选任务日期'); root.append(inspector);
      feedback = node('p', 'gantt-feedback'); feedback.setAttribute('role', 'status'); feedback.hidden = true;
      live = node('p', 'gantt-live'); live.setAttribute('aria-live', 'polite'); root.append(feedback, live);
      renderInspector(); viewport.scrollLeft = left; viewport.scrollTop = top;
      viewport.addEventListener('scroll', () => { saveScroll(); if (drag?.active) updateDrag(); }, { passive: true });
      if (session.focusControl) {
        const focus = session.focusControl; delete session.focusControl;
        root.querySelector(`[data-task-bar="${CSS.escape(focus.id)}"] [data-edge="${CSS.escape(focus.edge)}"]`)?.focus({ preventScroll: true });
      }
    }
    const keydown = event => { if (event.key === 'Escape' && drag) { event.preventDefault(); cancelDrag(true); } };
    const visibility = () => { if (document.hidden) cancelDrag(true); }, blur = () => cancelDrag(true);
    document.addEventListener('keydown', keydown); document.addEventListener('visibilitychange', visibility); window.addEventListener('blur', blur);
    draw();
    return () => {
      saveScroll(); cancelDrag(); stopped = true;
      if (toolbarContainer?.contains(toolbar)) toolbar.remove();
      document.removeEventListener('keydown', keydown); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('blur', blur);
    };
  }
  window.ProjectGantt = Object.freeze({ render });
})();
