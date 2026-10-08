'use strict';
document.getElementById('calculator').addEventListener('submit',event=>{event.preventDefault();const r=ACEHandle({op:document.getElementById('op').value,a:Number(document.getElementById('a').value),b:Number(document.getElementById('b').value)});document.getElementById('result').textContent=r.error||String(r.result);});
