/* Calendar dates are inclusive; reminders remain independent timestamps. */
((root)=>{
 'use strict';
 const ordinal=value=>Date.parse(value+'T00:00:00Z')/86400000;
 const end=task=>task.plannedDate?(task.plannedEndDate||task.plannedDate):null;
 const contains=(task,day)=>!!task.plannedDate&&task.plannedDate<=day&&end(task)>=day;
 const days=task=>task.plannedDate?ordinal(end(task))-ordinal(task.plannedDate)+1:0;
 const shift=(value,offset)=>{const result=new Date((ordinal(value)+offset)*86400000).toISOString().slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(result)||result<'0001-01-01')throw Error('日期超出支持范围');return result;};
 const rangeText=task=>!task.plannedDate?'未安排':task.plannedDate===end(task)?task.plannedDate:`${task.plannedDate}—${end(task)}`;
 const result=Object.freeze({end,contains,days,shift,rangeText});
 if(typeof module!=='undefined'&&module.exports)module.exports=result;else root.TaskDates=result;
})(typeof window!=='undefined'?window:globalThis);
