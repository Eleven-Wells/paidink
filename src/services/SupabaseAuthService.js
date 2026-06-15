const axios = require('axios');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

async function verifyAccessToken(accessToken) {
    try {
        const { data } = await axios.get(`${SUPABASE_URL}/auth/v1/user`, {
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${accessToken}`
            }
        });
        return { user: data, error: null };
    } catch (err) {
        return { user: null, error: err.response?.data || err.message };
    }
}

module.exports = {
    verifyAccessToken
};
