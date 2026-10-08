'use strict';
(function(){
const Decimal=typeof module !== 'undefined' ? require('decimal.js') : globalThis.Decimal;
function handle(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return {error:'invalid_request'};
  const {op,a,b} = request;
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b) || !['add','subtract','multiply','divide'].includes(op)) return {error:'invalid_request'};
  if (op === 'divide' && b === 0) return {error:'division_by_zero'};
  const x = new Decimal(a), y = new Decimal(b);
  const result = ({add:()=>x.plus(y),subtract:()=>x.minus(y),multiply:()=>x.times(y),divide:()=>x.div(y)})[op]().toNumber();
  return Number.isFinite(result) ? {result} : {error:'invalid_request'};
}
if(typeof module !== 'undefined')module.exports={handle};else globalThis.ACEHandle=handle;
})();
