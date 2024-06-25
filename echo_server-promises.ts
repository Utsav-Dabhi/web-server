import * as net from "net";

// promise-based API for TCP sockets
type TCPConn = {
  // the JS socket object
  socket: net.Socket;

  // from the 'error' event
  err: null | Error;

  // EOF, from the 'end' event
  ended: boolean;

  // the callbacks of the promise of the current read
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

// wrapper from net.Socket
function socketInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket: socket,
    reader: null,
    err: null,
    ended: false,
  };

  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader);

    // pause the 'data' event until next read
    conn.socket.pause();

    // fulfill promise of current read
    conn.reader!.resolve(data);
    conn.reader = null;
  });

  socket.on("end", () => {
    // this also fulfills current read
    conn.ended = true;

    if (conn.reader) {
      // EOF
      conn.reader.resolve(Buffer.from(""));
      conn.reader = null;
    }
  });

  socket.on("error", (err: Error) => {
    // errors are also delivered to current read
    conn.err = err;

    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });

  return conn;
}

function socketRead(conn: TCPConn): Promise<Buffer> {
  // no concurrent calls from same connection
  console.assert(!conn.reader);

  return new Promise((resolve, reject) => {
    // if connection is not readable, complete promise now
    if (conn.err) {
      reject(conn.err);
      return;
    }

    if (conn.ended) {
      // EOF
      resolve(Buffer.from(""));
      return;
    }

    // save promise callbacks
    conn.reader = { resolve: resolve, reject: reject };

    // resume 'data' event to fulfill promise later
    conn.socket.resume();
  });
}

function socketWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0);

  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }

    conn.socket.write(data, (err?: Error) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function serveClient(socket: net.Socket): Promise<void> {
  const conn: TCPConn = socketInit(socket);

  while (true) {
    const data = await socketRead(conn);

    if (data.length === 0) {
      console.log("Closing connection");
      break;
    }

    console.log("data", data);
    await socketWrite(conn, data);
  }
}

async function newConnection(socket: net.Socket): Promise<void> {
  console.log(
    "New connection from ",
    socket.remoteAddress + ":" + socket.remotePort
  );

  try {
    await serveClient(socket);
  } catch (excp) {
    console.error("Exception: ", excp);
  } finally {
    socket.destroy();
  }
}

const server = net.createServer({
  // required by `TCPConn`
  pauseOnConnect: true,
});

server.on("connection", (socket: net.Socket) => {
  // handle each new connection
  newConnection(socket).catch((err: Error) => {
    console.error("Error in new connection:", err);
  });
});

server.listen({ host: "127.0.0.1", port: 1234 }, () => {
  console.log("Server is listening on port 1234");
});
