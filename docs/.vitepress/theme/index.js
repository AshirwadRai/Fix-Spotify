import DefaultTheme from 'vitepress/theme';
import FeatureReel from './components/FeatureReel.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    // Registered globally so any markdown page can drop <FeatureReel /> in.
    app.component('FeatureReel', FeatureReel);
  },
};
