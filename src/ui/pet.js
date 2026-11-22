const pet = document.querySelector('#pet');
let origin, moved = false, lastDone = null, finishedClick = false, firstClick = false;
pet.addEventListener('pointerdown', e => { if (e.button !== 0) {firstClick=false;return;} origin = { x: e.screenX, y: e.screenY }; moved = false; finishedClick=false; pet.setPointerCapture(e.pointerId); window.planner.pet('dragStart'); });
pet.addEventListener('pointermove', e => { if (!origin) return; if (Math.hypot(e.screenX - origin.x, e.screenY - origin.y) > 6) moved = true; if (moved) window.planner.pet('drag'); });
pet.addEventListener('pointerup', e => { if (!origin) return; window.planner.pet('dragEnd'); finishedClick=!moved&&Math.hypot(e.screenX-origin.x,e.screenY-origin.y)<=6; if(!finishedClick)firstClick=false; origin = null; });
pet.addEventListener('click', e => {if(!finishedClick)return;finishedClick=false;const double=e.detail>0&&e.detail%2===0&&firstClick;firstClick=!double;window.planner.pet(double?'toggleSize':'open');});
function cancelPress(){origin=null;firstClick=false;finishedClick=false;window.planner.pet('dragEnd');}
pet.addEventListener('pointercancel', cancelPress);
pet.addEventListener('lostpointercapture', () => {if(origin)cancelPress();});
pet.addEventListener('contextmenu', e => { e.preventDefault();firstClick=false; window.planner.pet('menu'); });
async function refresh() {
 const result = await window.planner.invoke('snapshot'); if (!result.ok) return;
 const { tasks, events } = result.data;
 const unread = events.filter(e => !e.readAt).length;
 const done = tasks.filter(t => t.status === 'done').length;
 document.querySelector('#badge').hidden = !unread;
 pet.title = (unread ? `${unread} 条提醒 · ` : '')+'单击打开计划 · 双击放大／还原 · 拖动调整位置 · 右键更多';
 if (lastDone !== null && done > lastDone) { pet.classList.add('celebrate'); setTimeout(() => { pet.classList.remove('celebrate'); refresh(); }, 2200); }
 lastDone = done;
}
window.planner.onChange(refresh); refresh();
