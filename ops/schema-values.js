'use strict';
// Normalize SQL syntax, never the case or contents of string/ENUM literals.
function type(value) {
  const raw=String(value).trim();
  if(/^enum\s*\(/i.test(raw))return 'enum'+raw.replace(/^enum\s*/i,'');
  if(/^set\s*\(/i.test(raw))return 'set'+raw.replace(/^set\s*/i,'');
  let result=raw.toLowerCase().replace(/\s+/g,' ').replace(/^integer\b/,'int').replace(/^(numeric|dec)\b/,'decimal');
  if(/^(bool|boolean)$/.test(result))result='tinyint';
  if(!/\bzerofill\b/.test(result))result=result.replace(/\b(bigint|int|smallint|tinyint|mediumint)\(\d+\)/g,'$1');
  return result;
}
function literal(raw) {
  if(!/^'(?:[^'\\]|'')*'$/.test(raw))return null;
  return raw.slice(1,-1).replace(/''/g,"'");
}
function decimal(raw) {
  if(!/^[+-]?\d+(?:\.\d+)?$/.test(raw))return null;
  let [whole,fraction='']=raw.replace(/^\+/,'').split('.');
  const negative=whole.startsWith('-');whole=whole.replace(/^-/, '').replace(/^0+(?=\d)/,'');fraction=fraction.replace(/0+$/,'');
  return (negative&&(whole!=='0'||fraction)?'-':'')+whole+(fraction?'.'+fraction:'');
}
function defaultValue(value,column) {
  if(value===null)return {kind:column.IS_NULLABLE==='YES'?'null':'absent'};
  const original=String(value),raw=original.trim(),t=type(column.COLUMN_TYPE);
  if(column.defaultDialect==='mysql'&&/^(varchar|char|enum|set|text|mediumtext|longtext)\b/.test(t))return {kind:'string',value:original};
  if(/^null$/i.test(raw))return {kind:'null'};
  const decoded=literal(raw);
  if(/^(tinyint|smallint|mediumint|int|bigint|decimal|float|double)\b/.test(t)){
    const number=decimal(decoded===null?raw:decoded);
    if(number!==null)return {kind:'number',value:number};
  }
  if(/^(timestamp|datetime)(?:\(|$)/.test(t)&&/^current_timestamp(?:\(0?\))?$/i.test(raw))return {kind:'current_timestamp',precision:0};
  // Expressions and strings with unknown escaping stay distinct, fail closed.
  if(decoded!==null)return {kind:'string',value:decoded};
  if(/^(varchar|char|enum|set|text|mediumtext|longtext)\b/.test(t)&&!/[()'\\]/.test(raw))return {kind:'string',value:original};
  return {kind:'expression',value:raw};
}
const equalDefaults=(a,b)=>JSON.stringify(defaultValue(a.COLUMN_DEFAULT,a))===JSON.stringify(defaultValue(b.COLUMN_DEFAULT,b));
// Safe diagnostic descriptions: do not emit arbitrary DEFAULT/ENUM/EXTRA literals.
function describe(column){
  const t=type(column.COLUMN_TYPE), d=defaultValue(column.COLUMN_DEFAULT,column);
  const safeType=/^(?:enum|set)\(/.test(t)?t.split('(')[0]+'([redacted members])':/^[a-z]+(?:\([0-9,]+\))?(?: unsigned)?(?: zerofill)?$/.test(t)?t:'[redacted type]';
  return {type:safeType,nullable:column.IS_NULLABLE,charset:column.CHARACTER_SET_NAME,
    default:{kind:d.kind,...(d.kind==='number'?{value:d.value}:{}),...(d.kind==='current_timestamp'?{precision:d.precision}:{}),...(d.kind==='string'?{length:d.value.length}: {})},
    extra:/^(?:auto_increment|on update current_timestamp(?:\(\))?|DEFAULT_GENERATED|\s)*$/i.test(column.EXTRA)?column.EXTRA:'[redacted extra]'};
}
module.exports={type,defaultValue,equalDefaults,describe};
