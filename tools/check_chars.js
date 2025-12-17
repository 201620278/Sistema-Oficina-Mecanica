const fs = require('fs');
const s = fs.readFileSync('server.js','utf8');
const counts = {};
['(',' )','{','}','[',']','`'].forEach(c=>counts[c]= (s.split(c).length-1));
console.log(counts);
