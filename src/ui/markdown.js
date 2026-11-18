/* Offline Markdown reader. Raw HTML is text; images never initiate network requests. */
(function(root){
 const factory=typeof module==='object'&&module.exports?require('./vendor/markdown-it.min.js'):root.markdownit;
 const highlighter=typeof module==='object'&&module.exports?require('./vendor/highlight.min.js'):root.hljs;
 const md=factory({html:false,breaks:true,linkify:false,typographer:false,highlight:(code,language)=>{try{if(language&&highlighter.getLanguage(language))return highlighter.highlight(code,{language,ignoreIllegals:true}).value;}catch{}return '';}});
 md.renderer.rules.image=(tokens,index)=>{const token=tokens[index],src=token.attrGet('src'),alt=md.utils.escapeHtml(token.content||'图片');return /^plan-image:\/\/local\/[a-f0-9]{64}\.png$/.test(src)?'<img class="memory-image" src="'+src+'" alt="'+alt+'" loading="lazy" decoding="async">':'<span class="md-image-note">图片：'+alt+'（请通过插入图片保存到本地）</span>';};
 const tableOpen=md.renderer.rules.table_open||(()=>'<table>');
 const tableClose=md.renderer.rules.table_close||(()=>'</table>');
 md.renderer.rules.table_open=(...args)=>'<div class="md-table-scroll" tabindex="0" aria-label="表格，可横向滚动">'+tableOpen(...args);
 md.renderer.rules.table_close=(...args)=>tableClose(...args)+'</div>';
 const api={render:source=>md.render(String(source||''))};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MemoryMarkdown=api;
})(typeof window!=='undefined'?window:globalThis);
