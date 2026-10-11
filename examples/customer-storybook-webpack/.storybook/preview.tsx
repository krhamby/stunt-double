import type { Preview } from '@storybook/react-webpack5';
import { ThemeProvider } from '../src/theme';

// Every story renders inside the app's ThemeProvider, so overrides deep inside SDK components can prove they
// are the project's module instance (data-ctx="dark").
const preview: Preview = {
  decorators: [(Story) => <ThemeProvider value="dark"><Story /></ThemeProvider>],
};
export default preview;
