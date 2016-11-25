module.exports = function(grunt) {

  require('time-grunt')(grunt);

  // load all grunt tasks
  require('jit-grunt')(grunt);

  grunt.initConfig({
    watch: {
      options: {
        livereload: true
      },
      html: {
        files: ['index.html', 'css/**/*.css', 'js/**/*.js'],
      },
    },
  });

  grunt.registerTask('default', [
    'watch'
  ]);

};
