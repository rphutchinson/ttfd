#!/usr/bin/env node
var fs = require('fs'),
	sh = require('execSync'),
	_ = require('lodash'),
	moment = require('moment'),
	program = require('commander'),
	prompt = require('prompt'),
	parse = require('csv-parse'),
	components = [
		'CInD', 
		'Default Component', 
		'external-services',
		'Test Scripts',
		'Utilities'
		//todo: add additional components here as needed
	],
	teamMembers;

program.version('0.0.1')
	.option('-u, --username [value]', 'Your Username')
	.option('-p, --password [value]', 'Password')
	.option('-r, --repository [value]', 'Repository URL')
	.parse(process.argv);


var schema = {
	properties: {
	  username: {
	    pattern: /^[a-zA-Z\s\-]+$/,
	    message: 'Name must be only letters, spaces, or dashes',
	    required: true
	  },
	  password: {
	    hidden: true,
	    required: true
	  },
	  repository:{
	  	required: true
	  }
	}
};

prompt.override = program;
prompt.start();
prompt.get(schema, function(err, result){
	program.username = result.username;
	program.password = result.password;
	program.repository = result.repository;


	//parse the team member input
	var parser = parse({
		trim: true, 
		rtrim: true, 
		auto_parse: true, 
		columns: ['name', 'startDt']}, 
		function(err, data){
			teamMembers = data;
		});
	var fileReader = fs.createReadStream('example.csv').pipe(parser);

	fileReader.on("end", execute);
});

function execute(){
	var loginCmd = 'lscm login -r ' + program.repository + ' -u ' + program.username + ' -P ' + program.password + ' -n rAlias -c';
	sh.run(loginCmd);
	sh.run('lscm create workspace -r rAlias "tmp" --stream "1000"');

	var results = _.map(components, function(component){
		console.log("Loading history for component: " + component);
		return parseHistory(sh.exec('lscm history -r rAlias -w "tmp" -c "' + component + '" --maximum 1001').stdout);
	});

	sh.run('lscm workspace delete tmp -r rAlias');	
	sh.run('lscm logout -r rAlias');
	
	console.log('History collected for all components, consolidating results');
	var combinedResult = consolidateResults(results);

	console.log("Finding earliest changeset for each team member");
	var earliestChangeSets = findEarliestChangeSet(combinedResult);

	var times = {};
	_.forEach(teamMembers, function(tm){
		console.log(typeof tm.startDt);
		var teamMemberChangeSet = earliestChangeSets[tm.name];
		if(!teamMemberChangeSet){
			console.log("No change sets found for team member " + tm.name);
		} else {
			times[tm.name] = teamMemberChangeSet.date.getTime() - Date.parse(tm.startDt);
		}
	});

	var average = _.reduce(_.values(times), function(sum, t){return sum+t}, 0) /_.values(times).length;

	console.log("Average TTFD is " + Math.round(moment.duration(average).asHours()));

	_.forOwn(times, function(val, key){
		console.log(key + ': ' + moment.duration(val).asHours())
	})

}

function parseHistory(stdout){
	var history = _.filter(stdout.split("\n"), function(line){
		return line.indexOf('---$') !== -1
	});
	console.log("   --- " + history.length + ' changesets');

	history = _.groupBy(_.map(history, function(line){
		var indices = {
			nameStart: line.indexOf('$') + 2,
			nameEnd: line.indexOf('\"') - 1, 
			msgStart: line.indexOf('\"'),
			msgEnd: line.lastIndexOf('\"')	
		}
		
		return {
			name: line.substring(indices.nameStart, indices.nameEnd),
			msg: line.substring(indices.msgStart, indices.msgEnd),
			date: new Date(line.substring(indices.msgEnd+2))
		}
	}), 'name');
	return history;
}

function consolidateResults(results){
	var combinedResult = {};
	_.forEach(results, function(componentResult){
		_.forOwn(componentResult, function(changeSets, key){
			if(combinedResult[key]){
				combinedResult[key].concat(changeSets);
			} else {
				combinedResult[key] = changeSets;
			}
		})
	});

	return combinedResult;
}

function findEarliestChangeSet(combinedResult){
	var firstChangeSet = {};
	_.forEach(combinedResult, function(result, name){
		firstChangeSet[name] = _.min(result, 'date');
	});	

	return firstChangeSet;
}

















