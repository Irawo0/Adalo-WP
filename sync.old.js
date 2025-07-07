const axios = require('axios');
const WP_API_URL = 'https://dqg.wus.mybluehost.me/website_c1c91851/wp-json/wp/v2/listing';
const WP_USERNAME = 'Rev. Daniel';
const WP_APP_PASSWORD = 'XQz9 44Di ZZDp iJUD eIbb xok0';

const wpAuth = {
  auth: {
    username: WP_USERNAME,
    password: WP_APP_PASSWORD,
  },
};

async function fetchWPListings() {
  try {
    const res = await axios.get(WP_API_URL, wpAuth);
    return res.data;
  } catch (err) {
    console.error('There was an error connecting to WordPress:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
    return [];
  }
}

async function sync() {
  try {
    const wp = await fetchWPListings();

    if (!wp || wp.length === 0) {
      console.log('No WordPress records found.');
      return;
    }

    // Print the first WP record for inspection and mapping
    console.log('First WordPress listing:', wp[0]);
  } catch (err) {
    console.error('Unexpected error:', err.message);
  }
}

sync();