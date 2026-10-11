import { App } from '../../src/App';

export function meta() {
  return [{ title: 'customer-react-router: stunt-double example' }];
}

// The shared app: an app-level <Button> and the SDK's <Checkout>, both with the project's stunt doubles.
export default function Home() {
  return <App />;
}
