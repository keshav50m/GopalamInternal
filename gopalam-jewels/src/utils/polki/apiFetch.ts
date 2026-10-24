// Split JSON bulk operations before sending them; server limits remain enforced.
export const polkiFetch: typeof fetch = async (input, init) => {
  if (init?.method === "POST" && typeof init.body === "string") {
    const body = JSON.parse(init.body);
    const key = ["barcodes", "updates", "products", "items"].find(key => Array.isArray(body[key]));
    if (key) {
      const limit = key === "updates" ? 100 : key === "barcodes" ? (Array.isArray(body.itemNos) ? 500 : 1000) : 500;
      if (body[key].length > limit) {
        const combined: Record<string, any> = {success:true};
        for (let offset = 0; offset < body[key].length; offset += limit) {
          const response = await fetch(input, {...init, body:JSON.stringify({...body,[key]:body[key].slice(offset,offset+limit), ...(key === "barcodes" && Array.isArray(body.itemNos) ? {itemNos:body.itemNos.slice(offset,offset+limit)} : {})})});
          if (!response.ok) return response;
          const result = await response.json();
          for (const [name,value] of Object.entries(result)) {
            if (Array.isArray(value)) combined[name] = [...(combined[name] || []), ...value];
            else if (value && typeof value === "object") combined[name] = {...combined[name], ...value};
            else if (typeof value === "number") combined[name] = (combined[name] || 0) + value;
            else if (name === "success") combined.success &&= value;
            else combined[name] = value;
          }
        }
        return Response.json(combined);
      }
    }
  }
  return fetch(input, init);
};
