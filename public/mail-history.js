(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.crmMailHistory=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 // Presentation only: retain the complete stored text, including uncertain boundaries.
 function split(value){const body=String(value||'').replace(/\r\n?/g,'\n'),lines=body.split('\n');
  const index=lines.findIndex((line,i)=>/^(?:On .+wrote:|.+kirjutas(?: kuupäeval .+)?:|Am .+schrieb.+:|Le .+écrit\s*:|[-_]{2,}\s*(?:Original Message|Forwarded message|Algne sõnum).*)\s*$/i.test(line.trim())||/^>/.test(line)||(/^On /i.test(line.trim())&&[2,3].some(n=>/^On .+wrote:$/i.test(lines.slice(i,i+n).map(l=>l.trim()).join(' '))))||(/^(From|Saatja):\s*\S/i.test(line)&&lines.slice(i+1,i+7).some(l=>/^(Sent|Saadetud|Date|Kuupäev):/i.test(l))&&lines.slice(i+1,i+9).some(l=>/^(Subject|Teema):/i.test(l))));
  return index<0?{text:body,quoted:''}:{text:lines.slice(0,index).join('\n'),quoted:lines.slice(index).join('\n')};
 }
 return {split};
});
