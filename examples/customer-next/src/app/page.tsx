import { App } from '../App';

// A server component rendering the client <App/>: the app-level <Button> and the SDK's <Checkout>, both with the
// project's stunt doubles. `next build` prerenders it to static HTML, which the render probe reads.
export default function Page() {
  return <App />;
}
