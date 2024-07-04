import * as net from "net";

function newConnection(socket: net.Socket) {
  console.log(
    "New connection from ",
    socket.remoteAddress + ":" + socket.remotePort
  );

  socket.on("end", () => {
    console.log("EOF");
    console.log("Connection closed");
  });

  socket.on("data", (data: Buffer) => {
    console.log("Data: ", data);

    socket.write(data);

    if (data.includes("QUIT")) {
      console.log("Closing connection");
      socket.end();
    }
  });
}

const server = net.createServer();

// throw err if something goes wrong
server.on("error", (err: Error) => {
  throw err;
});

// run the callback on new connection
server.on("connection", newConnection);

// bind and listen on the address and port
server.listen({ host: "127.0.0.1", port: 1234 });
