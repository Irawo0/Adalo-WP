const axios = require('axios');
const FormData = require('form-data');

// --- CONFIGURATION ---
const ADALO_API_URL = 'https://api.adalo.com/v0/apps/10e41bc2-f34f-4f99-b61e-7b080f671c6a/collections/t_4tqfqolmxasl7kwysig1xnikl';
const ADALO_API_KEY = 'ch1m60bz1lqdkmj70asawndmy';

const WP_API_URL = 'https://dqg.wus.mybluehost.me/website_c1c91851/wp-json/wp/v2/listing';
const WP_MEDIA_API_URL = 'https://dqg.wus.mybluehost.me/website_c1c91851/wp-json/wp/v2/media';
const WP_USERNAME = 'Rev. Daniel';
const WP_APP_PASSWORD = 'XQz9 44Di ZZDp iJUD eIbb xok0';

const wpAuth = {
  auth: {
    username: WP_USERNAME,
    password: WP_APP_PASSWORD,
  },
};
// --- END CONFIGURATION ---

function getDefaultExtension(contentType) {
  if (contentType.includes('jpeg')) return '.jpg';
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('gif')) return '.gif';
  return '.jpg'; // fallback
}

function sanitizeFilename(filename, extension) {
  let safe = (filename || '').replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 50);
  safe = safe.replace(/\.[^/.]+$/, '') + extension;
  return safe;
}

// Adalo helpers
async function fetchAdaloListings() {
  const res = await axios.get(ADALO_API_URL, {
    headers: { Authorization: `Bearer ${ADALO_API_KEY}` },
  });
  return res.data.records;
}
async function createAdaloListing(data) {
  const res = await axios.post(ADALO_API_URL, data, {
    headers: { Authorization: `Bearer ${ADALO_API_KEY}` },
  });
  return res.data;
}
async function updateAdaloListing(id, data) {
  const url = `${ADALO_API_URL}/${id}`;
  const res = await axios.put(url, data, {
    headers: { Authorization: `Bearer ${ADALO_API_KEY}` },
  });
  return res.data;
}
async function deleteAdaloListing(id) {
  const url = `${ADALO_API_URL}/${id}`;
  await axios.delete(url, {
    headers: { Authorization: `Bearer ${ADALO_API_KEY}` },
  });
}

// WP helpers
async function fetchWPListings() {
  const res = await axios.get(WP_API_URL, wpAuth);
  return res.data;
}
async function createWPListing(data) {
  const res = await axios.post(WP_API_URL, data, wpAuth);
  return res.data;
}
async function updateWPListing(id, data) {
  const url = `${WP_API_URL}/${id}`;
  const res = await axios.put(url, data, wpAuth);
  return res.data;
}
async function deleteWPListing(id) {
  const url = `${WP_API_URL}/${id}`;
  await axios.delete(url, wpAuth);
}
async function uploadImageToWP(imageUrl, filename) {
  if (!imageUrl) return null;
  const imgRes = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  const contentType = imgRes.headers['content-type'] || '';
  if (!contentType.startsWith('image/')) {
    console.log(`Skipped non-image URL: ${imageUrl} (content-type: ${contentType})`);
    return null;
  }
  const extension = getDefaultExtension(contentType);
  const safeFilename = sanitizeFilename(filename, extension);
  const form = new FormData();
  form.append('file', imgRes.data, { filename: safeFilename, contentType });
  const mediaRes = await axios.post(WP_MEDIA_API_URL, form, {
    ...wpAuth,
    headers: { ...form.getHeaders() }
  });
  return mediaRes.data.id;
}

// =========== SYNC LOGIC ===========

// Map Adalo to WP format
async function mapAdaloToWP(adaloRecord) {
  const mainImgObj = adaloRecord['Listing main image'];
  const mainImgId = mainImgObj && mainImgObj.url
    ? await uploadImageToWP(mainImgObj.url, mainImgObj.filename)
    : null;
  return {
    title: adaloRecord['Listing Title'],
    content: adaloRecord.Description,
    status: 'publish',
    date: adaloRecord.created_at,
    meta: {
      _adalo_id: String(adaloRecord.id),
      price: adaloRecord['Listing Price'],
      location_name: adaloRecord['Listing Location']?.name,
      full_address: adaloRecord['Listing Location']?.fullAddress,
      wp_id: adaloRecord.wp_id || "",
      updated_at: adaloRecord.updated_at,
    },
    listing_category: adaloRecord.Category,
    featured_media: mainImgId,
  };
}

// Map WP to Adalo format
function mapWPToAdalo(wpRecord) {
  return {
    id: wpRecord.meta?._adalo_id, // will be blank if new
    'Listing Title': wpRecord.title?.rendered,
    Description: wpRecord.content?.rendered,
    Category: wpRecord.listing_category,
    'Listing Price': wpRecord.meta?.price,
    'Listing Location': { name: wpRecord.meta?.location_name, fullAddress: wpRecord.meta?.full_address },
    created_at: wpRecord.date,
    updated_at: wpRecord.modified,
    wp_id: String(wpRecord.id),
  };
}

// Two-way sync
async function twoWaySync() {
  const adaloListings = await fetchAdaloListings();
  const wpListings = await fetchWPListings();

  // Index by ids
  const adaloById = {}, adaloByWpId = {};
  adaloListings.forEach(r => {
    adaloById[r.id] = r;
    if (r.wp_id) adaloByWpId[r.wp_id] = r;
  });
  const wpById = {}, wpByAdaloId = {};
  wpListings.forEach(r => {
    wpById[String(r.id)] = r;
    if (r.meta && r.meta._adalo_id) wpByAdaloId[r.meta._adalo_id] = r;
  });

  // --- SYNC NEW AND UPDATED RECORDS IN BOTH DIRECTIONS ---
  // 1. Adalo → WP
  for (const adalo of adaloListings) {
    let wp = (adalo.wp_id && wpById[adalo.wp_id]) || wpByAdaloId[adalo.id];
    if (!wp) {
      // Not in WP, create
      const wpData = await mapAdaloToWP(adalo);
      const created = await createWPListing(wpData);
      // Update Adalo with new WP ID
      await updateAdaloListing(adalo.id, { wp_id: String(created.id) });
      console.log(`Created WP listing for Adalo ID ${adalo.id} → WP ID ${created.id}`);
    } else {
      // Exists in both, check which is newer
      const adaloUpdated = new Date(adalo.updated_at || adalo.created_at || 0).getTime();
      const wpUpdated = new Date(wp.modified || wp.date || 0).getTime();
      if (adaloUpdated > wpUpdated) {
        // Adalo is newer, update WP
        const wpData = await mapAdaloToWP(adalo);
        await updateWPListing(wp.id, wpData);
        console.log(`Updated WP ID ${wp.id} from Adalo ID ${adalo.id}`);
      } else if (wpUpdated > adaloUpdated) {
        // WP is newer, update Adalo
        const newData = mapWPToAdalo(wp);
        await updateAdaloListing(adalo.id, newData);
        console.log(`Updated Adalo ID ${adalo.id} from WP ID ${wp.id}`);
      }
    }
  }
  // 2. WP → Adalo (for listings that don't have Adalo ID)
  for (const wp of wpListings) {
    if (!wp.meta || !wp.meta._adalo_id) {
      // Not in Adalo, create
      const adaloData = mapWPToAdalo(wp);
      const created = await createAdaloListing(adaloData);
      // Update WP with Adalo ID
      await updateWPListing(wp.id, { meta: { ...wp.meta, _adalo_id: String(created.id) } });
      console.log(`Created Adalo listing for WP ID ${wp.id} → Adalo ID ${created.id}`);
    }
  }

  // --- SYNC DELETIONS ---
  // Listings deleted in Adalo, delete in WP
  const adaloIds = new Set(adaloListings.map(r => String(r.id)));
  for (const wp of wpListings) {
    if (wp.meta && wp.meta._adalo_id && !adaloIds.has(String(wp.meta._adalo_id))) {
      // Delete in WP
      await deleteWPListing(wp.id);
      console.log(`Deleted WP ID ${wp.id} (no longer in Adalo)`);
    }
  }
  // Listings deleted in WP, delete in Adalo
  const wpIds = new Set(wpListings.map(r => String(r.id)));
  for (const adalo of adaloListings) {
    if (adalo.wp_id && !wpIds.has(adalo.wp_id)) {
      await deleteAdaloListing(adalo.id);
      console.log(`Deleted Adalo ID ${adalo.id} (no longer in WP)`);
    }
  }

  console.log('Two-way sync complete!');
}

// Run main sync with better error handling
twoWaySync().catch(err => {
  if (err.response) {
    console.error('Sync error:', err.message);
    console.error('Status:', err.response.status);
    console.error('Data:', JSON.stringify(err.response.data, null, 2));
  } else {
    console.error('Sync error:', err.message);
  }
});