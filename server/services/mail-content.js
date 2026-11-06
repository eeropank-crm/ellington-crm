'use strict';
const VIDEO_ID='Hu6P50nQzbQ';
const VIDEO_URL='https://www.youtube.com/watch?v='+VIDEO_ID;
const THUMBNAIL_URL='https://i.ytimg.com/vi/'+VIDEO_ID+'/hqdefault.jpg';
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fragment=value=>escape(value).replace(/\t/g,'&nbsp; &nbsp; ').replace(/ {2,}/g,spaces=>' '+'&nbsp;'.repeat(spaces.length-1)).replace(/\r\n|\r|\n/g,'<br>');
function isVideo(url){
 try{
  const u=new URL(url);
  if(u.protocol!=='https:')return false;
  return (['www.youtube.com','youtube.com'].includes(u.hostname)&&u.pathname==='/watch'&&u.searchParams.get('v')===VIDEO_ID)||
   (u.hostname==='youtu.be'&&u.pathname==='/'+VIDEO_ID);
 }catch{return false;}
}
function videoCard(){
 // Presentation tables + inline styles work without scripts, video or iframe support.
 // The image and the Play button both link to the same canonical YouTube URL.
 return '<!--[if mso]><table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->'+
  '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:100%;max-width:480px;border-collapse:collapse;margin:12px 0;">'+
  '<tr><td style="padding:0;background-color:#111111;">'+
  '<a href="'+VIDEO_URL+'" target="_blank" style="display:block;text-decoration:none;">'+
  '<img src="'+THUMBNAIL_URL+'" width="480" border="0" alt="Ellingtoni video — vajuta vaatamiseks" style="display:block;width:100%;max-width:480px;height:auto;border:0;">'+
  '</a></td></tr><tr><td align="center" bgcolor="#cc0000" style="padding:14px 12px;background-color:#cc0000;">'+
  '<a href="'+VIDEO_URL+'" target="_blank" style="display:block;color:#ffffff;font-family:Arial,sans-serif;font-size:18px;font-weight:bold;text-decoration:none;">&#9654; Vaata videot YouTube’is</a>'+
  '</td></tr></table><!--[if mso]></td></tr></table><![endif]-->';
}
function render({body,purpose}){
 const text=String(body),allowVideo=String(purpose||'').trim()==='Video tutvustus';
 let cursor=0,html='',video=false;
 // Input is the existing plain-text draft. Never trust it as HTML.
 for(const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)){
  let url=match[0],tail='';
  while(/[.,;!?)\]]$/.test(url)){tail=url.slice(-1)+tail;url=url.slice(0,-1);}
  html+=fragment(text.slice(cursor,match.index));
  if(allowVideo&&!video&&isVideo(url)){html+=videoCard();video=true;}
  else html+='<a href="'+escape(url)+'" target="_blank">'+escape(url)+'</a>';
  html+=escape(tail);cursor=match.index+match[0].length;
 }
 html+=fragment(text.slice(cursor));
 return {text,html:'<!doctype html><html lang="et"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:16px;color:#17243b;background-color:#ffffff;"><div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;overflow-wrap:break-word;">'+html+'</div></body></html>',video};
}
module.exports={render,isVideo,VIDEO_URL,THUMBNAIL_URL};
