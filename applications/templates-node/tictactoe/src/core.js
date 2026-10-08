'use strict';
(function(){
const Decimal=typeof module !== 'undefined' ? require('decimal.js') : globalThis.Decimal;
const wins = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
function outcome(board) {
  for (const [a,b,c] of wins) if (board[a] !== '.' && board[a] === board[b] && board[b] === board[c]) return board[a];
  return board.includes('.') ? 'playing' : 'draw';
}
function handle(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || !Array.isArray(request.moves) || request.moves.length > 9) return {error:'invalid_request'};
  const board=Array(9).fill('.');
  for (const [turn,cell] of request.moves.entries()) {
    if (!Number.isInteger(cell) || typeof cell !== 'number' || cell < 0 || cell > 8) return {error:'invalid_request'};
    if (board[cell] !== '.' || outcome(board) !== 'playing') return {error:'invalid_move'};
    board[cell]=turn % 2 === 0 ? 'X' : 'O';
  }
  const status=outcome(board);
  return {board:board.join(''),status,next:status === 'playing' ? (request.moves.length % 2 === 0 ? 'X' : 'O') : null};
}
if(typeof module !== 'undefined')module.exports={handle};else globalThis.ACEHandle=handle;
})();
