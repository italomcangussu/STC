
interface AccessRequestData {
    id: string;
    phone: string;
    status: string;
    created_at: string;
}

// Helper to generate email from phone
export const generateEmailFromPhone = (phone: string) => {
    // Basic cleaning
    const cleanPhone = phone.replace(/\D/g, '');
    return `${cleanPhone}@reserva.com`;
};

// Helper to generated password (deterministic for prototype)
export const generatePasswordFromPhone = (phone: string) => {
    const cleanPhone = phone.replace(/\D/g, '');
    return `sct${cleanPhone}2024`;
};
