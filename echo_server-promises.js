"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var net = require("net");
// wrapper from net.Socket
function socketInit(socket) {
    var conn = {
        socket: socket,
        reader: null,
        err: null,
        ended: false,
    };
    socket.on("data", function (data) {
        console.assert(conn.reader);
        // pause the 'data' event until next read
        conn.socket.pause();
        // fulfill promise of current read
        conn.reader.resolve(data);
        conn.reader = null;
    });
    socket.on("end", function () {
        // this also fulfills current read
        conn.ended = true;
        if (conn.reader) {
            // EOF
            conn.reader.resolve(Buffer.from(""));
            conn.reader = null;
        }
    });
    socket.on("error", function (err) {
        // errors are also delivered to current read
        conn.err = err;
        if (conn.reader) {
            conn.reader.reject(err);
            conn.reader = null;
        }
    });
    return conn;
}
function socketRead(conn) {
    // no concurrent calls from same connection
    console.assert(!conn.reader);
    return new Promise(function (resolve, reject) {
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
function socketWrite(conn, data) {
    console.assert(data.length > 0);
    return new Promise(function (resolve, reject) {
        if (conn.err) {
            reject(conn.err);
            return;
        }
        conn.socket.write(data, function (err) {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
}
function serveClient(socket) {
    return __awaiter(this, void 0, void 0, function () {
        var conn, data;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    conn = socketInit(socket);
                    _a.label = 1;
                case 1:
                    if (!true) return [3 /*break*/, 4];
                    return [4 /*yield*/, socketRead(conn)];
                case 2:
                    data = _a.sent();
                    if (data.length === 0) {
                        console.log("Closing connection");
                        return [3 /*break*/, 4];
                    }
                    console.log("data", data);
                    return [4 /*yield*/, socketWrite(conn, data)];
                case 3:
                    _a.sent();
                    return [3 /*break*/, 1];
                case 4: return [2 /*return*/];
            }
        });
    });
}
function newConnection(socket) {
    return __awaiter(this, void 0, void 0, function () {
        var excp_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    console.log("New connection from ", socket.remoteAddress + ":" + socket.remotePort);
                    _a.label = 1;
                case 1:
                    _a.trys.push([1, 3, 4, 5]);
                    return [4 /*yield*/, serveClient(socket)];
                case 2:
                    _a.sent();
                    return [3 /*break*/, 5];
                case 3:
                    excp_1 = _a.sent();
                    console.error("Exception: ", excp_1);
                    return [3 /*break*/, 5];
                case 4:
                    socket.destroy();
                    return [7 /*endfinally*/];
                case 5: return [2 /*return*/];
            }
        });
    });
}
var server = net.createServer({
    // required by `TCPConn`
    pauseOnConnect: true,
});
server.on("connection", function (socket) {
    // handle each new connection
    newConnection(socket).catch(function (err) {
        console.error("Error in new connection:", err);
    });
});
server.listen({ host: "127.0.0.1", port: 1234 }, function () {
    console.log("Server is listening on port 1234");
});
