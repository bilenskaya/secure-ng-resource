﻿'use strict';

angular.module('secureNgResource')
.factory('authSession', [
'$q', '$location', '$cookieStore', '$injector', '$rootScope', '$timeout',
function($q, $location, $cookieStore, $injector, $rootScope, $timeout) {
    var DEFAULT_SETTINGS = {
        sessionName: 'angular',
        loginPath: '/login',
        logoutUrl: null,
        defaultPostLoginPath: '/'
    };

    var sessionDictionary = {};

    var AuthSession = function (auth, settings) {
        this.auth = auth;
        this.settings = angular.extend(
            {},
            DEFAULT_SETTINGS,
            settings
        );

        this.priorPath = null;
        this.state = null;
        this.managedHttpConfs = [];
        this.refreshPromise = null;

        sessionDictionary[this.cookieKey()] = this;
        var cookie = $cookieStore.get(this.cookieKey());
        if (cookie) {
            this.state = cookie;
        } else {
            this.reset();
        }
    };
    
    AuthSession.prototype = {
        getUserName: function () {
            if (this.loggedIn()) {
                return this.state.user;
            }
        },

        loggedIn: function () {
            // TODO Check for timeout
            return this.state !== null;
        },

        login: function (credentials) {
            var me = this;
            return this.auth.checkLogin(credentials).then(function(result) {
                me.state = result.newState;
                // FIXME This is silly
                if (me.state !== null && !('user' in me.state)) {
                    me.state.user = credentials.user;
                }
                me._onStateChange();

                var tgt = me.settings.defaultPostLoginPath;
                if (me.priorPath !== null) { tgt = me.priorPath; }
                $location.path(tgt).replace();
            });
        },

        cancelLogin: function () {
            this.auth.cancelLogin();
        },

        refreshLogin: function () {
            if (!this.loggedIn()) {
                throw 'Cannot refresh, not logged in.';
            }
            
            // FIXME Do something about failure, maybe retry soonish
            var me = this;
            return this.auth.refreshLogin(this.state).then(function(result) {
                var origUser = me.state.user;
                me.state = result.newState;
                // FIXME This is silly
                if (me.state !== null && !('user' in me.state)) {
                    me.state.user = origUser;
                }
                me._onStateChange();
            });
        },

        logout: function () {
            if (!this.loggedIn()) {
                return;
            }

            if (this.settings.logoutUrl !== null) {
                // FIXME Can't depend on $http directly, causes a false
                // alarm for circular dependency :-(
                var http = $injector.get('$http');
                var httpConf = {
                    method: 'POST',
                    data: '',
                    url: this.settings.logoutUrl
                };
                this.updateRequestConf(httpConf);
                http(httpConf);
            }
            this.reset();
            $location.path(this.settings.loginPath);
        },

        reset: function () {
            this.state = null;
            this._onStateChange();
        },

        cookieKey: function () {
            return this.settings.sessionName + '-' + this.auth.getAuthType();
        },

        updateRequestConf: function(httpConf) {
            httpConf.sessionDictKey = this.cookieKey();
            if (this.loggedIn()) {
                if (!httpConf.headers) { httpConf.headers = {}; }
                this.auth.addAuthToRequestConf(httpConf, this.state);
            }
        },

        manageRequestConf: function(httpConf) {
            this.managedHttpConfs.push({
                conf: httpConf,
                original: angular.copy(httpConf)
            });
            this.updateRequestConf(httpConf);
        },

        reupdateManagedRequestConfs: function() {
            var me = this;
            angular.forEach(this.managedHttpConfs, function(o) {
                for (var key in o.conf) { delete o.conf[key]; }
                var originalConf = angular.copy(o.original);
                angular.extend(o.conf, originalConf);
                me.updateRequestConf(o.conf);
            });
        },

        handleHttpResponse: function(response) {
            var authResult = this.auth.checkResponse(response);
            if (authResult.authFailure) {
                this.reset();
                this.priorPath = $location.path();
                $location.path(this.settings.loginPath).replace();
                return $q.reject(response);
            } else {
                return response;
            }
        },

        _onStateChange: function() {
            this.reupdateManagedRequestConfs();

            if (this.state !== null) {
                $cookieStore.put(this.cookieKey(), this.state);
                if (this.refreshPromise !== null) {
                    $timeout.cancel(this.refreshPromise);
                }
                if ('millisecondsToRefresh' in this.state) {
                    var me = this;
                    this.refreshPromise = $timeout(
                        function() { me.refreshLogin(); },
                        this.state.millisecondsToRefresh
                    );
                }
            } else {
                if (this.refreshPromise !== null) {
                    $timeout.cancel(this.refreshPromise);
                    this.refreshPromise = null;
                }
                $cookieStore.remove(this.cookieKey());
            }
        }
    };

    var AuthSessionFactory = function(auth, settings) {
        return new AuthSession(auth, settings);
    };
    AuthSessionFactory.dictionary = sessionDictionary;
    return AuthSessionFactory;
}]);
