import { useEffect, useState } from 'react';
import App from './App';
import { AutomationsPage } from './AutomationsPage';

/** Hash routing keeps working behind Home Assistant Ingress:  #/  = all automations,  #/a/<id>  = editor. */
export default function Root() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const m = /^#\/a\/([a-z0-9_-]{1,64})$/.exec(hash);
  return m
    ? <App key={m[1]} id={m[1]} onBack={() => { window.location.hash = '#/'; }} />
    : <AutomationsPage onOpen={id => { window.location.hash = `#/a/${id}`; }} />;
}
