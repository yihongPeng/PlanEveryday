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
 function headingText(tokens){return (tokens||[]).map(token=>{
  if(token.type==='image')return headingText(token.children)||token.content;
  if(token.type==='softbreak'||token.type==='hardbreak')return ' ';
  return token.type==='text'||token.type==='code_inline'?token.content:'';
 }).join('').trim();}
 for(const type of ['fence','code_block']){
  const render=md.renderer.rules[type];
  md.renderer.rules[type]=(tokens,index,...rest)=>{
   const html=render(tokens,index,...rest),token=tokens[index];
   return token.meta?.sourceMap?'<div data-source-start="'+token.map[0]+'" data-source-end="'+token.map[1]+'">'+html+'</div>':html;
  };
 }
 function renderDocument(source,{sourceMap=false}={}){
  const env={},tokens=md.parse(String(source||''),env),headings=[],used=new Set();
  for(let i=0;i<tokens.length;i++){
   const token=tokens[i];
   if(sourceMap&&token.map){
    if(token.type==='fence'||token.type==='code_block')token.meta={sourceMap:true};
    else if(['heading_open','paragraph_open','list_item_open','tr_open','hr'].includes(token.type)){
     token.attrSet('data-source-start',String(token.map[0]));
     token.attrSet('data-source-end',String(token.map[1]));
    }
   }
   if(token.type!=='heading_open')continue;
   const text=headingText(tokens[i+1]?.children)||'未命名标题';
   const slug=text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu,'').trim().replace(/\s+/g,'-')||'section';
   const base='memory-heading-'+slug;let id=base,suffix=2;
   while(used.has(id))id=base+'-'+suffix++;
   used.add(id);token.attrSet('id',id);token.attrSet('tabindex','-1');
   headings.push({id,level:Number(token.tag.slice(1)),text});
  }
  return {html:md.renderer.render(tokens,md.options,env),headings};
 }
 const api={render:source=>renderDocument(source).html,renderDocument};
 if(typeof module==='object'&&module.exports)module.exports=api;else root.MemoryMarkdown=api;
})(typeof window!=='undefined'?window:globalThis);
