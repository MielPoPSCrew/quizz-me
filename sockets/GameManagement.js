/* global DB */

const Game = require('./Game'),
      _    = require('lodash');

/**
 * Game session handle
 */
class GameManagement {
    constructor () {
        this.game         = new Game();
        this.initialized  = false;
        this.currentRound = 0;
        this.scores       = {};
        this.users        = [];
        this.rounds       = [];
    }

    /**
     * Initialize the game session with game information from DB and connect the user to the game then
     *
     * @param {Object} socket - User socket object
     * @param {string} username - The new user name
     * @param {string} gameId - The game ID
     *
     * @throws {Error} If the game is not found
     *
     * @return {undefined}
     */
    init (socket, username, gameId) {

        const self = this;

        /**
         * @var {GameMongoLike} game
         * @var {QuizMongoLike} quiz
         */
        DB.get('games')
          .findOne({"_id": gameId})
          .then((game) => {
              if (_.isEmpty(game)) {
                  throw new Error('This game does not exists.');
              }

              // Get answers
              DB.get('quiz')
                .findOne({"_id": game.quiz})
                .then((quiz) => {
                    // Get users
                    DB.get('users')
                      .find({"_id": {"$in": _.concat([], game.creator, game.users, quiz.creator)}})
                      .then((users) => {
                          self.game.loadGameFromMongo(game, quiz, users);
                          self.initialized = true;
                          console.log('[' + self.game._id+ '] : initialized');
                          this.userJoin(socket, username);
                      });
                });
          });
    }

    /*******************
     * Callable events *
     *******************/

    /**
     * Initialize the game session if it is not already done and add the user to the game session
     *
     * @param {Object} socket - User socket object
     * @param {string} username - The new user name
     * @param {string} gameId - The game ID
     *
     * @return {undefined}
     */
    userConnect (socket, username, gameId) {
        if (this.initialized) {
            this.userJoin(socket, username);
        } else {
            // console.log('init userConnect');
            this.init(socket, username, gameId);
        }
    }

    /**
     * Launch the game by the game admin
     *
     * @param {Object} socket - User socket object
     * @param {string} username - The new user name
     *
     * @throws {Error} If the user is not the game admin
     *
     * @return {undefined}
     */
    launchGame (socket, username) {

        if (username !== this.game.creator.username) {
            throw new Error('Your are not the admin of the game');
        }

        console.log('[' + this.game._id+ '] : game begin');

        // Alert users that the game is starting
        socket.in(this.game._id).emit('gameStart', {nbPlayers:_.size(this.users)});
        socket.emit('gameStart', {nbPlayers:_.size(this.users)});

        // Start the first round after 5 sec
        //_.delay(this.startRound, 5000, socket);
        this.startRound(socket);
    }

    /**
     * Update the round answer with the new answer received, call the next round if it was the last answer needed
     *
     * @param {Object} socket - User socket object
     * @param {string} username - The new user name
     * @param {number} answer - The user answer index
     *
     * @return {undefined}
     */
    receiveAnswer (socket, username, answer) {
        this.rounds[this.currentRound].push({username, answer, "time": new Date() - this.timer});
        this.scores[username] += _.size(this.users) - this.answered++;

        console.log('[' + this.game._id+ '] : received answer from' + username + ' : ' + answer);

        // Alert users that the user answer the question
        socket.in(this.game._id).emit("userAnswer", {username});
        socket.emit("userAnswer", {username});

        if (this.answered === _.size(this.users)) {
            // Alert users that the round is ended and share the scores
            // clearTimeout(this.timeout);
            // this.endRound(socket);
            // End of the game if this was the last question
            if (++this.currentRound === _.size(this.game.quiz.questions)) {
                console.log('[' + this.game._id+ '] : game end');
                socket.in(this.game._id)("gameEnd");
                socket.emit("gameEnd");
            } else {
                // Start the new round
                console.log('[' + this.game._id+ '] : new round');
                this.startRound(socket);
            }
        }
    }

    /*********************
     * Utilities methods *
     *********************/

    /**
     * Add a user in the game and warn the others users
     *
     * @param {Object} socket - User socket object
     * @param {string} username - The new user name
     *
     * @throws {Error} If the user is not found in the DB
     * @throws {Error} If the user is already in the game
     *
     * @return {undefined}
     */
    userJoin (socket, username) {
        const self = this;

        // Get the user information
        DB.get('users')
          .findOne({ username: username })
          .then((user) => {
              if (_.isEmpty(user)) {
                  throw new Error('User not found on the database');
              }

              if (!_.isUndefined(_.find(self.users, user))) {
                  throw new Error('User is already in the game');
              }

              // Add the user to the game session
              self.users.push(user);
              self.scores[username] = 0;

              // Send the event to all the users in the room

              console.log('[' + this.game._id+ '] : ' + username + ' join the game');

              socket.in(this.game._id).emit("userEnterInTheGame", {"users": self.users});
              socket.emit("userEnterInTheGame", {"users": self.users});

              // Send the game info to the user
              socket.emit("gameEnter", {
                  // eslint-disable-next-line no-underscore-dangle
                  "gameId"           : self.game._id,
                  "numberOfQuestions": _.size(self.game.quiz.questions),
                  "gameTitle"        : self.game.name
              });
          });
    }

    /**
     * Start a new round
     *
     * @param {Object} socket - User socket object
     *
     * @return {undefined}
     */
    startRound (socket) {
        const self = this;

        //console.log(this);

        this.answered = 0;
        this.timer    = new Date();
        this.timeout  = _.delay(this.endRound, 13000, socket, this);

        console.log('[' + this.game._id+ '] : starting round ' + self.currentRound);

        socket.in(this.game._id).emit("roundStart", {
            "roundNumber": self.currentRound,
            "question"   : self.game.quiz.questions[self.currentRound].question,
            "choices"    : self.game.quiz.questions[self.currentRound].choices
        });
        socket.emit("roundStart", {
            "roundNumber": self.currentRound,
            "question"   : self.game.quiz.questions[self.currentRound].question,
            "choices"    : self.game.quiz.questions[self.currentRound].choices
        });
    }

    /**
     * End the current round
     *
     * @param {Object} socket - User socket object
     *
     * @return {undefined}
     */
    endRound (socket, gameManagement) {
        const self = gameManagement;
        console.log('[' + self.game._id+ '] : ending round ' + self.currentRound);
        console.log(self.scores);
        // Alert users that the round is ended and share the scores

        var cleanScore = [];
        _.forEach(self.scores, function(value, key) {
            cleanScore.push({
                username: key,
                score : value
            })
        });

        console.log(cleanScore);

        socket.in(self.game._id).emit("roundEnd", {
            "scores"    : cleanScore,
            "goodAnswer": self.game.quiz.questions[self.currentRound].answer,
            "answerInfo": self.game.quiz.questions[self.currentRound].info
        });
        socket.emit("roundEnd", {
            "scores"    : cleanScore,
            "goodAnswer": self.game.quiz.questions[self.currentRound].answer,
            "answerInfo": self.game.quiz.questions[self.currentRound].info
        });
    }
}

module.exports = GameManagement;
