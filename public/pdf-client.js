export async function openPdf(mission,pin=''){
 const response=await fetch('/api/dispatch/pdf',{method:'POST',headers:{'Content-Type':'application/json',...(pin?{'X-App-Pin':pin}:{})},body:JSON.stringify({mission})});
 if(!response.ok){const text=await response.text();let message=text;try{message=JSON.parse(text).error||text}catch{}throw Error(message.slice(0,350))}
 if(!String(response.headers.get('content-type')||'').includes('application/pdf'))throw Error('Server returned non-PDF response; check deployment');
 const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${String(mission.code||'AeroMission').replace(/[^A-Za-z0-9_-]/g,'_')}-DISPATCH.pdf`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),15000);
}
