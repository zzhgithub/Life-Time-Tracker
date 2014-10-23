#!/usr/bin/env node

'use strict';
//dependencies
var util = require('./util'),
    msg = require('./message'),
    program = require('commander'),
    moment = require('moment'),
    extend = require('node.extend'),
    //normal life scanner
    scanner = require('./scanner'),
    //output the stat result
    outputor = require('./outputor'),
    //sync evernote
    evernoteSync = require('./sync/evernote'),
    //Tag
    Tag = require('./tag'),
    tagOutputor = require('./outputors/tag'),
    Project = require('./project'),
    projectOutputor = require('./outputors/project'),
    _ = require('lodash'),
    statist = require('./statist'),
    Msg = require('./message'),
    Param = require('./param'),
    getDateParams = Param.getDateParams,
    Remind = require('./remind'),
    importer = require('./importer'),
    Action = require('./action'),
    Search = require('./search/search');


//connect to database
var db = require('./model/db');
db.connect();


program
    .version('0.1.0')
    .option('-ol, --originLogs', 'show origin logs');

program
    .option('-p, --perspective <s>', 'choose an perspective')
    .option('-c, --calandar <date>', 'see activity calandar')
    .command('stat <date>')
    .description('对所选日期进行统计')
    .action(stat);

program
    .option('--auto', 'auto sync logs')
    .option('-f, --filter <s>', 'use to filter logs')
    .command('logs <date>')
    .description('按日期查询日志')
    .action(dispatch);

program
    .command('sync [date]')
    .description('同步日志 the date can be today month week yesterday or a date string')
    .action(syncLogs);

program
    .option('-cups, --cups <s>', 'set the cups of water should drink one day', number)
    .option('-i, --interval <s>', 'remind interval', number)
    .option('-ahead, --ahead <s>', 'ahead of time', number)
    .command('remind <type>')
    .description('对某一个行为进行提醒，例如喝水提醒，日程提醒')
    .action(remind);

program
    .command('action <action>')
    .description('执行某一个动作,例如喝水drink')
    .action(takeAction);

program
    .option('-t, --top <n>', 'top N of a list', number)
    .option('-o, --order <order>', 'desc or asc')
    .command('tags <date>')
    .description('列出某段时间的tags')
    .action(wrapDateProcess(listTags));

program
    .option('-t, --top <n>', 'top N of a list', number)
    .option('-o, --order <order>', 'desc or asc')
    .command('projects <date>')
    .description('列出某段时间的进行的项目')
    .action(wrapDateProcess(listProjects));

program
    .command('server')
    .option('-p,--port <port>', 'server listen port')
    .description('开启服务器')
    .action(startServer);
program
    .option('--type <type>', '需要导入的类型,例如logs,projects')
    .command('import <date>')
    .description('导入某一段时间的日志')
    .action(wrapDateProcess(importLogs));

program
    .command('query <date>')
    .description('导入某一段时间的日志')
    .action(wrapDateProcess(query));

program.parse(process.argv);


function listTags (dateStr, options) {
    Tag.get(options)
        .then(function (tags) {
            tagOutputor.dispose(tags);
        });
}


function listProjects (dateStr, options) {
    Project.get(options)
        .then(function (projects) {
            projectOutputor.dispose(projects);
        });
}


function wrapDateProcess(func) {
    return function (dateStr) {
        var userOptions = getUserOptions(),
            dateOptions;
        dateOptions = getDateParams(dateStr);
        var options = extend({}, userOptions, dateOptions);
        var args = _.toArray(arguments);
        args.splice(args.length - 1, 0, options);
        return func.apply(null, args);
    };
}


function dispatch(dateStr) {
    if (!isDateValid(dateStr)) {
        return;
    }
    //standardlize the date 2014-08-01 to 2014-8-1
    dateStr = standardizeDate(dateStr);
    var dateArr = dateStr.split('-').map(function(val) {
        return parseInt(val, 10);
    });
    var dateType = [null, 'year', 'month', 'day'][dateArr.length],
        userOptions = getUserOptions();
    var options = extend({}, userOptions, {
        dateType: dateType,
        dateStr: dateStr,
        dateArr: dateArr
    });

    //get the corresponding statist of specific type, type can be `day` and `month` for now
    var statist = getStatist(dateType, options);

    /**
     * the statist is used to stat the log data the then scanner have scan
     *
     * process step
     *     1. scan
     *     2. stat
     *     3. output
     */
    var promise = scanner.scan(options);
    if (statist && statist.dispose) {
        promise = promise.then(statist.dispose.bind(statist, options));
    }
    if (outputor && outputor.dispose) {
        promise = promise.then(outputor.dispose.bind(outputor, options));
    }
}


function stat(dateStr) {
    var userOptions = getUserOptions(),
        dateOptions;
    Msg.info('统计' + dateStr + '的日志');
    dateOptions = getDateParams(dateStr);
    var options = extend({}, userOptions, dateOptions);

    /**
     * the statist is used to stat the log data the then scanner have scan
     *
     * process step
     *     1. scan
     *     2. stat
     *     3. output
     */
    var promise = scanner.scan(options)
        .then(statist.dispose.bind(statist, options))
        .then(function (statResult) {
            return outputor.dispose(statResult, options);
        });
    return promise;
}


function syncLogs(dateStr) {
    var userOptions = getUserOptions(),
        dateOptions;
    Msg.info('正在同步' + dateStr + '的日志');
    dateOptions = getDateParams(dateStr);
    var options = extend({}, userOptions, dateOptions);
    evernoteSync.sync(options);
}




function isDateValid(dateStr) {
    if (!dateStr) {
        msg.error('should have a date arguments.');
        return false;
    }
    var date = new Date(dateStr);
    if (!util.isValidDate(date)) {
        msg.error('the date is not right!');
        return false;
    }
    return true;
}


function getStatist(type) {
    var statistPath = './statists/' + type;
    return require(statistPath);
}


function getUserOptions() {
    var userOptions = {};
    setOption([
        'perspective',
        'filter',
        'calandar',
        'cups',
        'interval',
        'ahead',
        'auto',
        'order',
        'top',
        'type'
    ]);
    return userOptions;

    function setOption(names) {
        if (_.isString(names)) {
            names = [names];
        }
        names.forEach(function(name) {
            if (program[name] === undefined) {
                return;
            }
            var value = program[name];
            userOptions[name] = value;
            msg.info('set ' + name + ' = ' + value);
        });
    }
}


function standardizeDate(dateStr) {
    var length = dateStr.split('-').length;
    var dateFormat = ['YYYY', 'YYYY-MM', 'YYYY-MM-DD'][length - 1];
    var tmpMoment = new moment(dateStr, dateFormat);
    return tmpMoment.format(dateFormat);
}


function remind(type) {
    var options = getUserOptions();
    var reminder = Remind.get(type, options);
    if (reminder) {
        reminder.watch();
        Msg.info('已启动' + reminder.name);
    } else {
        Msg.error('unknow reminder ' + type);
    }
}

function takeAction(actionName) {
    var options = getUserOptions();
    var action = Action.get(actionName);
    if (action) {
        action.execute(options);
    }
}


function startServer() {
    var options = getUserOptions();
    var server = require('./server/main');
    server.run(options);
}

function number(val) {
    return parseInt(val, 10);
}

function importLogs(dateStr, options) {
    importer.importFromLogFile(options);
}


function query(dateStr, options) {
    Search.query(options).then(function (result) {
        console.log('一共找到' + result.length + '条日志.');
        console.log(result);
    });
}
