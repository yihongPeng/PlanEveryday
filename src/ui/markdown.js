/* Offline Markdown reader. Raw HTML is text; images never initiate network requests. */
(function(root){
 const factory=typeof module==='object'&&module.exports?require('./vendor/markdown-it.min.js'):root.markdownit;
 const md=factory({html:false,breaks:true,linkify:false,typographer:false});
 md.renderer.rules.image=(tokens,index)=>'<span class="md-image-note">图片：'+md.utils.escapeHtml(tokens[index].content||'未命名')+'</span>';
 const tableOpen=md.renderer.rules.table_open||(()=>'<table>');
 const tableClose=md.renderer.rules.table_close||(()=>'</table>');
 md.renderer.rules.table_open=(...args)=>'<div class="md-table-scroll" tabindex="0" aria-label="表格，可横向滚动">'+tableOpen(...args);
 md.renderer.rules.table_close=(...args)=>tableClose(...args)+'</div>';
 const api={render:source=>md.render(String(source||''))};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MemoryMarkdown=api;
})(typeof window!=='undefined'?window:globalThis);
