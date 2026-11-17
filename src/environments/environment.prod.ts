export const environment = {
  production: true,
  // This file feeds Angular's generic web `production` build, which the edge
  // container ships to browsers. It is NOT used by the native iOS app. Edge
  // serves this build and proxies /api and /images to the server container
  // from the same origin, so the API is a same-origin relative path. The iOS
  // backend origin comes from the generated environment.ios.*.ts instead.
  apiUrl: '',
};
