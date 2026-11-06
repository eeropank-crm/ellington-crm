const {test}=require('node:test');
const assert=require('node:assert/strict'),nodemailer=require('nodemailer');
const {simpleParser}=require('mailparser');
const {render,isVideo,VIDEO_URL,THUMBNAIL_URL}=require('../server/services/mail-content');
test('Video tutvustus replaces the exact YouTube link with a linked 480px thumbnail and Play button',()=>{
 const body='Tere!\n\nTutvu meie videoga: '+VIDEO_URL+'\n\nParimate soovidega\nEero';
 const result=render({body,purpose:'Video tutvustus'});
 assert.equal(result.text,body);assert.equal(result.video,true);
 assert.ok(result.html.includes('src="'+THUMBNAIL_URL+'"'));assert.ok(result.html.includes('width="480"'));assert.ok(result.html.includes('max-width:480px;height:auto'));
 assert.equal(result.html.match(new RegExp('href="'+VIDEO_URL.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'"','g')).length,2);
 assert.ok(result.html.includes('&#9654; Vaata videot'));assert.ok(result.html.includes('Tere!<br><br>Tutvu meie videoga: '));assert.ok(result.html.includes('<br><br>Parimate soovidega<br>Eero'));
 assert.equal(/<script|<iframe|<video|onclick=|javascript:/i.test(result.html),false);
});
test('supported short/query variants resolve to the fixed video, not arbitrary hosts or IDs',()=>{
 for(const url of ['https://youtu.be/Hu6P50nQzbQ','https://www.youtube.com/watch?v=Hu6P50nQzbQ&t=12s','https://youtube.com/watch?v=Hu6P50nQzbQ'])assert.equal(isVideo(url),true);
 for(const url of ['http://www.youtube.com/watch?v=Hu6P50nQzbQ','https://www.youtube.com.evil.invalid/watch?v=Hu6P50nQzbQ','https://www.youtube.com@evil.invalid/watch?v=Hu6P50nQzbQ','https://www.youtube.com/watch?v=other','javascript:alert(1)'])assert.equal(isVideo(url),false);
});
test('other templates and drafts without that video retain their content without injecting a preview',()=>{
 for(const input of [{purpose:'Other template',body:VIDEO_URL},{purpose:'Video tutvustus',body:'Tere!\n\nAinult tekst.'},{purpose:'Video tutvustus',body:'https://www.youtube.com/watch?v=another'}]){
  const result=render(input);assert.equal(result.text,input.body);assert.equal(result.video,false);assert.equal(result.html.includes(THUMBNAIL_URL),false);
 }
});
test('untrusted content is escaped, URLs are escaped and punctuation stays outside links',()=>{
 const body='<img src=x onerror="alert(1)"> & \'hello\'\n'+VIDEO_URL+'.\nhttps://example.invalid/?x=1&y=2';
 const result=render({body,purpose:'Video tutvustus'});
 assert.ok(result.html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
 assert.ok(result.html.includes('&amp; &#39;hello&#39;'));
 assert.ok(result.html.includes('href="https://example.invalid/?x=1&amp;y=2"'));
 assert.ok(result.html.includes('</table><![endif]-->.'));
 assert.equal(result.html.includes('<img src=x'),false);assert.equal(result.text,body);
});
test('only one preview is inserted when the link is repeated; line endings and Unicode remain intact',()=>{
 const body='Tere, Õie!\r\n\r\n'+VIDEO_URL+'\r\n'+VIDEO_URL+'\rLõpp 🙂';
 const result=render({body,purpose:'Video tutvustus'});assert.equal(result.text,body);assert.equal(result.html.split('src="'+THUMBNAIL_URL+'"').length-1,1);assert.ok(result.html.includes('Tere, Õie!<br><br>'));assert.ok(result.html.includes('<br>Lõpp 🙂'));
});
test('Nodemailer creates multipart/alternative with the original text and the HTML thumbnail without sending mail',async()=>{
 const body='Tere!\n\n'+VIDEO_URL+'\n\nParimate soovidega',content=render({body,purpose:'Video tutvustus'});
 const transport=nodemailer.createTransport({streamTransport:true,buffer:true,newline:'unix'});
 const result=await transport.sendMail({from:'sender@example.invalid',to:'recipient@example.invalid',subject:'Synthetic MIME test',text:content.text,html:content.html});
 assert.ok(result.message.toString().includes('Content-Type: multipart/alternative'));
 const parsed=await simpleParser(result.message);assert.equal(parsed.text.trim(),body);assert.equal(parsed.html,content.html);assert.equal(parsed.attachments.length,0);
});
