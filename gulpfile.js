'use strict';

// Require dependencies
var $ = require('gulp-load-plugins')();
var assign = require('lodash.assign');
var babelify = require('babelify');
var browserify = require('browserify');
var browserSync = require('browser-sync').create();
var buffer = require('vinyl-buffer');
var del = require('del');
var gulp = require('gulp');
var gulpSSHConfig = require('./ssh-config');
var Imagemin = require('imagemin');
var imageminGifsicle = require('imagemin-gifsicle');
var imageminMozjpeg = require('imagemin-mozjpeg');
var imageminOptipng = require('imagemin-optipng');
var imageminPngquant = require('imagemin-pngquant');
var imageminSvgo = require('imagemin-svgo');
var os = require('os');
var parallel = require('concurrent-transform');
var runSequence = require('run-sequence');
var source = require('vinyl-source-stream');
var watchify = require('watchify');

// Configurations
var AUTOPREFIXER_BROWSERS = [
  'Android >= 4.3',
  'Chrome >= 46',
  'ChromeAndroid >= 46',
  'Firefox >= 42',
  'FirefoxAndroid >= 42',
  'Explorer >= 10',
  'ExplorerMobile >= 11',
  'Edge >= 12',
  'iOS >= 8',
  'Safari >= 8'
];
var cores = os.cpus().length;
var distDirName = 'dist';
var distRemoteDirName = './public_html/staging';
var distLogsDirName = 'logs';
var gulpSSH = $.ssh(gulpSSHConfig);

// This task will create a new distribution folder and deploy it to the server.
gulp.task('deploy', ['default'], function () {
  runSequence('deploy:clean', 'deploy:compress', 'deploy:clean-remote', 'deploy:upload', 'deploy:extract', function () {
    console.log('Deploy finished');
  });
});

// This deployment helper task deletes the current distribution tarball, if one exists.
gulp.task('deploy:clean', function () {
  $.run('rm ' + distDirName + '.tar.gz').exec()
    .pipe(gulp.dest(distLogsDirName));
});

// This deployment helper task creates a tarball from the distribution folder.
gulp.task('deploy:compress', function () {
  return gulp.src(distDirName + '/**/*')
    .pipe($.tar(distDirName + '.tar'))
    .pipe($.gzip())
    .pipe(gulp.dest('.'));
});

// This deployment helper task deletes all existing files in the server directory.
gulp.task('deploy:clean-remote', function () {
  return gulpSSH.shell([
      'cd ' + distRemoteDirName,
      'rm -rf ./*'
    ], {filePath: 'clean-remote-commands.log'})
    .pipe(gulp.dest(distLogsDirName));
});

// This deployment helper task uploads the distribution tarball to the server directory.
gulp.task('deploy:upload', function () {
  return gulp.src(distDirName + '.tar.gz')
    .pipe(gulpSSH.sftp('write', distRemoteDirName + '/' + distDirName + '.tar.gz'));
});

// This deployment helper task extracts the distribution tarball to the server directory and then deletes the tarball.
gulp.task('deploy:extract', function () {
  return gulpSSH.shell([
      'cd ' + distRemoteDirName,
      'gunzip ./' + distDirName + '.tar.gz',
      'tar -xvf ./' + distDirName + '.tar --overwrite',
      'rm ./' + distDirName + '.tar'
    ], {filePath: 'extract-commands.log'})
    .pipe(gulp.dest(distLogsDirName));
});

// Browserify configuration
var browserifyCustomOptions = {
  entries: ['app/scripts/scripts.js'],
  extensions: ['.js', '.jsx'],
  debug: true
};
var browserifyOptions = assign({}, watchify.args, browserifyCustomOptions);
var browserifyWatcher = watchify(browserify(browserifyOptions));

browserifyWatcher.transform(babelify);
browserifyWatcher.on('update', bundle);
browserifyWatcher.on('log', $.util.log);

function bundle() {
  return browserifyWatcher.bundle()
    .on('error', $.util.log.bind($.util, 'Browserify error'))
    .pipe(source('bundle.js'))
    .pipe(buffer())
    .pipe($.sourcemaps.init({loadMaps: true}))
    .pipe($.sourcemaps.write('./'))
    .pipe(gulp.dest('app/scripts'));
}

gulp.task('bundle', bundle);

// Clean output directory
gulp.task('clean', del.bind(null, ['.tmp', 'dist/*', '!dist/.git']));

gulp.task('copy', function () {
  return gulp.src([
      'app/**/*',
      '!app/images',
      '!app/images/**/*'
    ], {
      dot: true
    })
    .pipe(gulp.dest('dist'))
    .pipe($.size({title: 'copy'}));
});

gulp.task('images', function () {
  var gifsicleOptions = {
    interlaced: true
  };
  var mozjpegOptions = {
    quality: 60
  };
  var optipngOptions = {
    optimizationLevel: 7
  };
  var pngquantOptions = {
    quality: '75-85',
    speed: 1
  };
  var svgoOptions = {};

  return gulp.src('app/images/**/*.{png,jpg,jpeg,gif,svg}')
    .pipe(parallel(imageminPngquant(pngquantOptions)(), cores))
    .pipe(parallel(imageminOptipng(optipngOptions)(), cores))
    .pipe(parallel(imageminMozjpeg(mozjpegOptions)(), cores))
    .pipe(parallel(imageminSvgo(svgoOptions)(), cores))
    .pipe(parallel(imageminGifsicle(gifsicleOptions)(), cores))
    .pipe(gulp.dest(distDirName + '/images'));
});

// Compile and automatically prefix stylesheets
gulp.task('styles', function () {
  return $.rubySass('app/styles/main.scss', {
      precision: 10,
      sourcemap: true,
      style: 'expanded',
      verbose: true
    })
    .on('error', function (err) {
      console.error('gulp-sass error!', err.message);
    })
    .pipe($.autoprefixer({browsers: AUTOPREFIXER_BROWSERS}))
    .pipe($.sourcemaps.write())
    .pipe(gulp.dest('.tmp/styles'))
    .pipe(gulp.dest('app/styles'));
});

// Watch Files for Changes & Reload
gulp.task('serve', ['bundle', 'styles'], function () {
  browserSync.init({
    notify: false,
    open: false,
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    server: ['.tmp', 'app']
  });

  gulp.watch(['app/index.html'], browserSync.reload);
  gulp.watch(['app/images/**/*'], browserSync.reload);
  gulp.watch(['app/scripts/bundle.js'], browserSync.reload);
  gulp.watch(['app/styles/**/*.{scss,css}'], ['styles', browserSync.reload]);
  gulp.watch(['app/assets/**/*'], browserSync.reload);
});

// Build and serve the output from the dist build
//gulp.task('serve:dist', ['default'], function () {
gulp.task('serve:dist', function () {
  browserSync.init({
    notify: false,
    open: false,
    // Run as an https by uncommenting 'https: true'
    // Note: this uses an unsigned certificate which on first access
    //       will present a certificate warning in the browser.
    // https: true,
    //server: ['.tmp', 'app']
    server: distDirName
  });
});

// Build production files, the default task
gulp.task('default', ['clean'], function (cb) {
  runSequence('copy', ['bundle', 'images', 'styles'], cb);
});
