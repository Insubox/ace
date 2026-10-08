WINS = ((0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6),
        (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6))


def outcome(board):
    for a, b, c in WINS:
        if board[a] != "." and board[a] == board[b] == board[c]:
            return board[a]
    return "draw" if "." not in board else "playing"


def handle(request):
    if not isinstance(request, dict):
        return {"error": "invalid_request"}
    moves = request.get("moves")
    if not isinstance(moves, list) or len(moves) > 9:
        return {"error": "invalid_request"}
    board = ["."] * 9
    for turn, cell in enumerate(moves):
        if type(cell) is not int or not 0 <= cell <= 8:
            return {"error": "invalid_request"}
        if board[cell] != "." or outcome(board) != "playing":
            return {"error": "invalid_move"}
        board[cell] = "X" if turn % 2 == 0 else "O"
    status = outcome(board)
    return {"board": "".join(board), "status": status,
            "next": ("X" if len(moves) % 2 == 0 else "O")
            if status == "playing" else None}
