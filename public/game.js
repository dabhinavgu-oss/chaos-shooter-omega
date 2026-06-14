const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

ctx.fillStyle = "black";
ctx.fillRect(100, 100, 200, 200);

ctx.fillStyle = "red";
ctx.font = "30px Arial";
ctx.fillText("GAME IS LOADED", 100, 80);
