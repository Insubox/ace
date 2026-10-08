export function requireServedVersion(response,expected){
 if(response.headers.get('x-ace-worker-version')!==expected)throw Error('Requested Worker version was not served; refusing promotion');
}
