'use strict';
(function(){
const Decimal=typeof module !== 'undefined' ? require('decimal.js') : globalThis.Decimal;
function handle(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return {error:'invalid_request'};
  const name = Object.hasOwn(request,'name') ? request.name : 'World';
  if (typeof name !== 'string' || [...name].length > 80) return {error:'invalid_request'};
  return {message:'Hello, ' + (name.trim() || 'World') + '!'};
}
if(typeof module !== 'undefined')module.exports={handle};else globalThis.ACEHandle=handle;
})();
