import axios from 'axios';

export async function showFiatAssets () {
  try {
    const response = await axios.get('https://abe.zelcore.io/v1/purchase/sellassets');
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function showCryptoAssets () {
  try {
    const response = await axios.get('https://abe.zelcore.io/v1/purchase/buyassets');
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function getPurchaseDetailByPurchaseId (purchaseid: string) {
  try {
    const response = await axios.get(`https://abe.zelcore.io/v1/purchase/detail?purchaseid=${purchaseid}`);
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function submitPurchase (purchaseid: string, providerid: string) {
  try {
    const response = await axios.get(`https://abe.zelcore.io/v1/purchase/submit?purchaseid=${purchaseid}&providerid=${providerid}`);
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function getPurchaseHistory (zelid: string) {
  try {
    const response = await axios.get(`https://abe.zelcore.io/v1/offramp/user/history?zelid=${zelid}`);
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function getPurchaseDetails (data: any) {
  try {
    const response = await axios.post(`https://abe.zelcore.io/v1/purchase/pairdetails`, data, {
      headers: { 
        'Content-Type' : 'application/json'
      }
    });
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function getPurchaseDetailsSelectedAsset (data: any) {
  try {
    const response = await axios.post(`https://abe.zelcore.io/v1/purchase/pairdetailssellamount`, data, {
      headers: { 
        'Content-Type' : 'application/json'
      }
    });
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function createPurchase (data: any, zelid: string) {
  try {
    const response = await axios.post(`https://abe.zelcore.io/v1/purchase/createpurchase`, data, {
      headers: { 
        'Content-Type' : 'application/json',
        'zedid': zelid
      }
    });
    return response.data;
  } catch(error) {
    console.log(error);
    return {message: "Error occured in processing"};
  };
}

export async function getPurchaseStatus (data: any) {
  try {
    const response = await axios.post(`https://abe.zelcore.io/v1/purchase/status`, data, {
      headers: { 
        'Content-Type' : 'application/json'
      }
    });
    return response.data;
  } catch(error) {
    console.log(error);
    return {};
  };
}





