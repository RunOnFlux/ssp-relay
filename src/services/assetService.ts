import axios from 'axios';

export async function showFiatAssets () {
  try {
    const response = await axios.get('https://abe.zelcore.io/v1/purchase/sellassets');
    return response.data;
  } catch(error) {
    console.log(error);
    return {};
  };
}

export async function showCryptoAssets () {
  try {
    const response = await axios.get('https://abe.zelcore.io/v1/purchase/buyassets');
    return response.data;
  } catch(error) {
    console.log(error);
    return {};
  };
}

export async function getPurchaseDetailByPurchaseId (purchaseid: string) {
  try {
    const response = await axios.get(`https://abe.zelcore.io/v1/purchase/detail?purchaseid=${purchaseid}`);
    return response.data;
  } catch(error) {
    console.log(error);
    return {};
  };
}

export async function submitPurchase (purchaseid: string, providerid: string) {
  try {
    const response = await axios.get(`https://abe.zelcore.io/v1/purchase/submit?purchaseid=${purchaseid}&providerid=${providerid}`);
    return response.data;
  } catch(error) {
    console.log(error);
    return {};
  };
}

export async function getPurchaseHistory (zelid: string) {
  try {
    const response = await axios.get(`https://abe.zelcore.io/v1/offramp/user/history?zelid=${zelid}`);
    return response.data;
  } catch(error) {
    console.log(error);
    return {};
  };
}




