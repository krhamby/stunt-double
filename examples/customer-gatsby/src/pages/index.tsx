import type { HeadFC } from 'gatsby';
import { App } from '../App';

export default function IndexPage() {
  return <App />;
}

export const Head: HeadFC = () => <title>customer-gatsby</title>;
