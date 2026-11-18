const pet = document.querySelector('#pet');
let origin, moved = false, lastDone = null;
pet.addEventListener('pointerdown', e => { if (e.button !== 0) return; origin = { x: e.screenX, y: e.screenY }; moved = false; pet.setPointerCapture(e.pointerId); window.planner.pet('dragStart'); });
pet.addEventListener('pointermove', e => { if (!origin) return; if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 6) moved = true; if (moved) window.planner.pet('drag'); });
pet.addEventListener('pointerup', () => { if (!origin) return; window.planner.pet('dragEnd'); if (!moved) window.planner.pet('open'); origin = null; });
pet.addEventListener('pointercancel', () => { origin = null; window.planner.pet('dragEnd'); });
pet.addEventListener('contextmenu', e => { e.preventDefault(); window.planner.pet('menu'); });
async function refresh() {
 const result = await window.planner.invoke('snapshot'); if (!result.ok) return;
 const { tasks, events } = result.data;
 const unread = events.filter(e => !e.readAt).length;
 const done = tasks.filter(t => t.status === 'done').length;
 document.querySelector('#badge').hidden = !unread;
 pet.title = unread ? `${unread} 条提醒 · 点击打开计划` : '点击打开计划 · 拖动调整位置 · 右键更多';
 if (lastDone !== null && done > lastDone) { pet.classList.add('celebrate'); setTimeout(() => { pet.classList.remove('celebrate'); refresh(); }, 2200); }
 lastDone = done;
}
window.planner.onChange(refresh); refresh();
