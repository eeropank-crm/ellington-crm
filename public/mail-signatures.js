(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.crmSignatures=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const text=value=>String(value||'').replace(/\r\n?/g,'\n').trim();
 function strip(body,signatures){
  let result=text(body);
  for(const value of signatures){const signature=text(value);if(!signature)continue;
   while(result===signature||result.endsWith('\n'+signature))result=text(result.slice(0,-signature.length));
  }
  return result;
 }
 function compose(body,signature){const sig=text(signature),content=strip(body,[sig]);return content+(sig?(content?'\n\n':'')+sig:'');}
 return {text,strip,compose};
});
