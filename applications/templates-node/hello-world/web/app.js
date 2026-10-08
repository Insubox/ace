'use strict';
document.getElementById('hello').addEventListener('submit',event=>{event.preventDefault();document.getElementById('result').textContent=ACEHandle({name:document.getElementById('name').value}).message;});
