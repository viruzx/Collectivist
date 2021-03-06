'use strict';


var app = require('express')();
var q = require('q');
var http = require('http').Server(app);
var io = require('socket.io')(http);
var fs = require('fs');
var Crypto = require("crypto");
var escape = require('escape-html');
var cookieParser = require('cookie-parser')
var cookieParser2 = require('socket.io-cookie');
var bodyParser = require('body-parser')
var util = require('util');
var moment = require('moment');
var log_file = fs.createWriteStream(__dirname + '/debug.log', {
    flags: 'w'
});
var log_stdout = process.stdout;
var multer = require('multer');
var upload = multer({
    dest: './uploads'
});


io.use(cookieParser2);

app.use(cookieParser());

//Overload console.log to log to file.
console.log = function(d) {
    d = "[" + moment().format() + "]" + d;
    process.stdout.write(d + '\n');
    log_file.write(util.format(d) + '\n');
};


String.prototype.hashCode = function() {
    var hash = 0,
        i, chr, len;
    if (this.length === 0) return hash;
    for (i = 0, len = this.length; i < len; i++) {
        chr = this.charCodeAt(i);
        hash = ((hash << 5) - hash) + chr;
        hash |= 0;
    }
    return hash;
};

Array.prototype.includes = function(searchElement /*, fromIndex*/ ) {

    var O = Object(this);
    var len = parseInt(O.length, 10) || 0;
    if (len === 0) {
        return false;
    }
    var n = parseInt(arguments[1], 10) || 0;
    var k;
    if (n >= 0) {
        k = n;
    } else {
        k = len + n;
        if (k < 0) {
            k = 0;
        }
    }
    var currentElement;
    while (k < len) {
        currentElement = O[k];
        if (searchElement === currentElement ||
            (searchElement !== searchElement && currentElement !== currentElement)) { // NaN !== NaN
            return true;
        }
        k++;
    }
    return false;
};

function sortJSON(data, key) {
    return data.sort(function(a, b) {
        var x = a[key];
        var y = b[key];
        return ((x < y) ? -1 : ((x > y) ? 1 : 0));
    });
}

var tokens = [];

function logout(token) {
    console.log("Destroying token: " + token);
    console.log("De-auth " + tokens[token]);
    delete tokens[token];
}
app.use(bodyParser.json({
    limit: '10mb'
})); // to support JSON-encoded bodies
app.use(bodyParser.urlencoded({ // to support URL-encoded bodies
    limit: '10mb',
    extended: true
}));


function newToken() {
    return Crypto.randomBytes(8).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/\=/g, '');
}

var vouchers = [];
console.log("Generating 30 voucher codes. These are reset on every restart.")
for (var i = 0; i != 30; i++){
    var voucher = newToken();
    console.log("New voucher: " + voucher);
    vouchers.push(voucher);
}

fs.appendFileSync("vouchers.txt", vouchers.join("\n"));
vouchers = fs.readFileSync("vouchers.txt", 'utf8').split("\n");

function useVoucher(voucher){
    if (vouchers.indexOf(voucher) !== -1){
        delete vouchers[vouchers.indexOf(voucher)];
        fs.writeFile("vouchers.txt", vouchers.join("\n"));
        return true;
    } else {
        return false;
    }

}

function loggedIn(token) {
    if (tokens[token] == undefined) {
        return false;
    } else {
        return tokens[token];
    }
}
app.get('/', function(req, res) {
    if (!loggedIn(req.cookies.token)) {
        //debugging shit
        console.log(__dirname + '/login.html');
        res.sendFile(__dirname + '/login.html');
    } else {
        res.sendFile(__dirname + '/index.html');
    }
});
app.post('/auth', function(req, res) {
    var username = req.body.username.toLowerCase();
    var password = req.body.password.hashCode();
    console.log("Attempted authentication: " + username + " ********");
    var token = newToken();
    var data = fs.readFile(__dirname + "/users/" + username + ".json", function (err, data){
        if (err){
            res.writeHead(302, {
                'Location': '/'
            });
            res.end();
            return;
        }
        var json = JSON.parse(data);
        if (json.password == password && !err) {
            res.cookie("token", token);
            res.cookie("localUser", req.body.username);
            tokens[token] = username;
            console.log("User " + username + " is authenticated under the token " + token);
        } else {
            console.log("User auth for " + username + " has failed. Token is destroyed.");
        }
        res.writeHead(302, {
            'Location': '/'
        });
        res.end();
    });


});

//Scripts and CSS
app.get('/static/:file', function(req, res) {
    res.sendFile(__dirname + '/ressources/' + req.params.file);
});

app.get('/uploads/:file', function(req, res) {
    res.sendFile(__dirname + '/uploads/' + req.params.file);
});

app.get('/favicon.ico', function(req, res) {
    res.sendFile(__dirname + '/ressources/favicon.ico');
});

app.get('/register', function(req, res) {
    res.sendFile(__dirname + '/register.html');
});

app.post('/register', function(req, res) {
    if (vouchers.indexOf(req.body.voucher) !== -1){
        console.log("Trying voucher " + req.body.voucher);
        var userobject = {
            username: req.body.username.toLowerCase(),
            password: req.body.password.hashCode()
        };
        var raw = JSON.stringify(userobject);
        console.log("Attempted registration: " + raw);
        fs.writeFile(__dirname + "/users/" + userobject.username + ".json", raw, { flag: 'wx' }, function (err){
            if (err){
                console.log("Failed to register " + userobject.username + ": Already taken");
                res.send("Username already taken");
            } else {
                useVoucher(req.body.voucher);
                console.log("Registered " + userobject.username);
                res.send("Registered");
            }

        });
    } else {
        res.send("Invalid Voucher");
    }
});

app.get("/logout", function(req, res) {
    logout(req.cookies.token);
    res.sendFile(__dirname + '/login.html');
});
app.get("/msglog", function(req, res) {
    if (!loggedIn(req.cookies.token)) {
        res.sendFile(__dirname + '/login.html');
    } else {
        fs.readFile(__dirname + '/msglog.html', function(err, value) {
            if (err){
                res.send("");
            } else {
                //Convert to string, get 100 latest messages and send.
                console.log(req.query.page);
                res.send((value + "").split("\n").reverse().slice(0 + 100 * req.query.page, 100 + 100 * req.query.page).reverse().join(""));
            }

        });
    }
});
//Threads
app.get('/threads/:threadid', function(req, res) {
    if (!loggedIn(req.cookies.token)) {
        res.sendFile(__dirname + '/login.html');
    } else {
        if (req.params.threadid == "list.json") {
            fs.readdir(__dirname + "/threads/", function(err, files) {
                if (err) return;
                var tmp = [];
                files.forEach(function(f, i) {
                    fs.readFile(__dirname + "/threads/" + f, 'utf8', function (err, contents){
                        if (err){
                            return;
                        }
                        var topush = JSON.parse(contents);
                        tmp.push(topush);
                        if (i == files.length - 1){
                            //Yes! It works!
                            res.send(sortJSON(tmp, 'points'));
                        }
                    });

                });

            });
        } else {
            console.log("Requesting file " + __dirname + '/threads/' + req.params.threadid);
            res.sendFile(__dirname + '/threads/' + req.params.threadid);
        }
    }

});


app.post('/chat/image', upload.single('image'), function(req, res) {
    if (!loggedIn(req.cookies.token)) {
        res.sendFile(__dirname + '/login.html');
    } else {
        var msg = {
            sender: loggedIn(req.cookies.token),
            message: "/" + req.file.path,
        }
        io.emit('chat image', msg);

        var messagehtml = '<li class="' + msg.sender + ' msgtxt"><p class="msg"><b>' + msg.sender + ':</b> <img src="' + msg.message + '"></p></li>\n';
        fs.appendFile(__dirname + '/msglog.html', messagehtml, function(err) {

        });
        console.log(JSON.stringify(msg));
        res.send(JSON.stringify(msg));
        console.log(msg.sender + " has sent an image");
    }
});

app.post('/post/new', upload.single('image'), function(req, res) {
    if (!loggedIn(req.cookies.token)) {
        res.sendFile(__dirname + '/login.html');
    } else {
        console.log("New Post");

        //Create object
        var postObject = {
            id: newToken(),
            title: escape(req.body.title),
            poster: escape(loggedIn(req.cookies.token)),
            body: escape(req.body.body),
            image: function(){
                if (req.file){
                    return "/" + req.file.path;
                } else {
                    return "";
                }
            }(),
            time: Date.now(),
            points: Date.now(),
            replies: []
        };
        console.log(JSON.stringify(postObject));
        console.log("Writing file " + __dirname + '/threads/' + postObject.id + ".json");
        fs.writeFile(__dirname + '/threads/' + postObject.id + ".json", JSON.stringify(postObject), function(err) {

            if (err) throw err;

            console.log('New Thread');
            io.sockets.emit('thread new', postObject);
            res.send(JSON.stringify(postObject));
        });
    }
});

app.post('/post/reply', upload.single('image'), function(req, res) {
    if (!loggedIn(req.cookies.token)) {
        res.sendFile(__dirname + '/login.html');
    } else {
        var postObject = {
            id: escape(req.body.threadid),
            title: escape(req.body.title),
            poster: escape(loggedIn(req.cookies.token)),
            body: escape(req.body.body),
            image: function(){
                if (req.file){
                    return "/" + req.file.path;
                } else {
                    return "";
                }
            }(),
            time: Date.now()
        };

        if (!(postObject.title == "")){


            fs.readFile(__dirname + "/threads/" + postObject.id + ".json", function(err, current) {
                if (err){
                    return;
                }
                var thread = JSON.parse(current);
                thread.points += 20000;
                var reply = postObject;
                thread.replies.push(reply);
                var json = JSON.stringify(thread);
                res.send(json);
                if (postObject.title == "DELETE" && postObject.poster == thread.poster) {
                    fs.unlink(__dirname + "/threads/" + postObject.id + ".json");
                    io.sockets.emit('thread delete', thread.id);
                } else {
                fs.writeFile(__dirname + '/threads/' + postObject.id + ".json", json, function(err) {

                    if (err) throw err;

                    console.log('New REply');
                    io.sockets.emit('reply new', postObject);
                });
                }
            });
        }
    }
});
var clients = [];
Array.prototype.getUnique = function() {
    var u = {},
        a = [];
    for (var i = 0, l = this.length; i < l; ++i) {
        if (u.hasOwnProperty(this[i])) {
            continue;
        }
        a.push(this[i]);
        u[this[i]] = 1;
    }
    return a;
}

function onlineList() {
    var arr = clients.getUnique();
    return arr.toString();
}

function isOnline(id) {
    return clients.includes(id);
}

function removeUser(id) {
    var lock = false;
    clients.forEach(function(v, i, a) {
        if (v == id) {
            if (!lock) {
                delete clients[i];
                lock = true;
            }

        }
    });
    //clean up
    clients = clients.filter(function(n) {
        return n != undefined
    });
}
io.on('connection', function(socket) {
    var username = loggedIn(socket.request.headers.cookie.token);
    if (!username) {
        socket.disconnect();
    } else {
        socket.username = username;
        if (!isOnline(socket.username)) {
            io.emit("chat status", {
                sender: socket.username,
                message: "has connected"
            });
            console.log(socket.username + " has connected");
            var messagehtml = '<li class="msgnotif"><p class="msg"><b>' + socket.username + '</b> ' + "has connected" + '</p></li>';

            socket.typinglast = false;
            socket.typingloop = setInterval(function() {
                    if (isOnline(socket.username)) {
                        io.emit('typing', {
                            username: socket.username,
                            id: "typing-" + socket.id.split("").splice(2, 21).join(""),
                            typing: socket.typing
                        });
                        socket.typinglast = !socket.typinglast;
                    } else {
                        io.emit('typing', {
                            username: socket.username,
                            id: "typing-" + socket.id.split("").splice(2, 21).join(""),
                            typing: false
                        });
                        clearInterval(socket.typingloop);
                    }
                    socket.typing = false;
                }, 1000)
                //fs.appendFile('msglog.html', messagehtml, function(err) {});
        }

        clients.push(socket.username);
    }

    socket.on('chat message', function(data) {
        if (data != "") {
            var msg = {
                sender: socket.username,
                message: escape(data)
            }
            io.emit('chat message', msg);
            console.log(msg.sender + ": " + msg.message);
            if (msg.message == "!online") {
                io.emit('chat message', {
                    sender: "slava",
                    message: onlineList()
                });
            }
            var messagehtml = '<li class="' + msg.sender + ' msgtxt"><p class="msg"><b>' + msg.sender + ':</b> ' + msg.message + '</p></li>\n';
            fs.appendFile(__dirname + '/msglog.html', messagehtml, function(err) {

            });


        }

    });

    socket.typing = false;
    socket.on('typing', function(data) {
        socket.typing = true;

    });

    socket.on('disconnect', function() {
        removeUser(socket.username);

        io.emit('typing', {
            username: socket.username,
            id: "typing-" + socket.id.split("").splice(2, 21).join(""),
            typing: false
        });

        if (!isOnline(socket.username)) {
            setTimeout(function() {
                if (!isOnline(socket.username)) {
                    io.emit("chat status", {
                        sender: socket.username,
                        message: "has disconnected"
                    });
                    console.log(socket.username + " has disconnected");
                } else {
                    console.log(socket.username + " has reconnected");
                }
            }, 2000);
        }


    });
});

http.listen(process.env.PORT || 3000, function() {
    console.log("Collectivist is ready");
});
