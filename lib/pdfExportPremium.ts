import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface Registration {
    id: string;
    championship_id: string;
    participant_type: 'socio' | 'guest';
    user_id: string | null;
    guest_name: string | null;
    class: string;
    shirt_size: string;
    created_at: string;
    user?: { name: string; avatar_url: string };
}

interface Championship {
    id: string;
    name: string;
    registration_open: boolean;
}

const CLASSES = ['1ª Classe', '2ª Classe', '3ª Classe', '4ª Classe', '5ª Classe', '6ª Classe'];

export const generatePremiumPDF = async (
    championship: Championship,
    registrations: Registration[],
    getRegistrationsByClass: (className: string) => Registration[],
    getParticipantName: (reg: Registration) => string
) => {
    // Create a dedicated container for the PDF content
    const container = document.createElement('div');
    container.style.position = 'absolute';
    container.style.top = '0';
    container.style.left = '0';
    container.style.width = '800px';
    container.style.zIndex = '-9999';
    container.style.background = '#ffffff';
    container.style.fontFamily = "'Inter', sans-serif";
    container.style.color = '#1c1917';

    const today = new Date().toLocaleDateString('pt-BR');
    const nonEmptyClasses = CLASSES.filter(c => getRegistrationsByClass(c).length > 0);

    let htmlContent = `
        <div style="padding: 40px;">
            <!-- HEADER -->
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #f97316; padding-bottom: 20px; margin-bottom: 30px;">
                <div>
                    <h1 style="font-size: 28px; font-weight: 900; color: #ea580c; margin: 0; line-height: 1.2; text-transform: uppercase;">
                        ${championship.name}
                    </h1>
                    <p style="font-size: 14px; color: #78716c; margin: 5px 0 0 0; font-weight: 500;">
                        LISTA OFICIAL DE INSCRITOS
                    </p>
                </div>
                <div style="text-align: right;">
                    <div style="font-size: 40px; font-weight: 900; color: #f97316;">${registrations.length}</div>
                    <div style="font-size: 10px; text-transform: uppercase; color: #a8a29e; font-weight: 700;">Atletas Inscritos</div>
                </div>
            </div>

            <!-- CONTENT -->
            <div style="display: grid; gap: 20px;">
    `;

    nonEmptyClasses.forEach(cls => {
        const classRegs = getRegistrationsByClass(cls);
        htmlContent += `
            <div style="margin-bottom: 10px;">
                <div style="background-color: #fff7ed; padding: 10px 15px; border-left: 4px solid #f97316; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-weight: 800; color: #9a3412; font-size: 16px;">${cls}</span>
                    <span style="background-color: #f97316; color: white; padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700;">${classRegs.length}</span>
                </div>
                
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
        `;

        classRegs.forEach((reg, i) => {
            const name = getParticipantName(reg);
            const isGuest = reg.participant_type === 'guest';
            const typeLabel = isGuest ? 'CONVIDADO' : 'SÓCIO';
            const typeColor = isGuest ? '#d6d3d1' : '#22c55e';

            htmlContent += `
                    <div style="border: 1px solid #f5f5f4; padding: 8px 12px; border-radius: 8px; display: flex; align-items: center; justify-content: space-between; background-color: #fafaf9;">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span style="font-size: 12px; font-weight: 700; color: #d6d3d1; width: 20px;">${i + 1}.</span>
                            <div>
                                <div style="font-weight: 600; font-size: 13px; color: #292524;">${name}</div>
                                <div style="font-size: 9px; color: #78716c; margin-top: 1px;">
                                    <span style="color: ${typeColor}; font-weight: 700;">${typeLabel}</span>
                                    • Tamanho ${reg.shirt_size}
                                </div>
                            </div>
                        </div>
                    </div>
            `;
        });

        htmlContent += `
                </div>
            </div>
        `;
    });

    htmlContent += `
            </div>

            <!-- FOOTER -->
            <div style="margin-top: 50px; padding-top: 20px; border-top: 1px solid #e7e5e4; display: flex; justify-content: space-between; align-items: center;">
                <div style="font-size: 10px; color: #a8a29e;">
                    Gerado via <strong>STC Play</strong> em ${today}
                </div>
                <div style="font-size: 10px; color: #d6d3d1;">
                    sistema.stcplay.com.br
                </div>
            </div>
        </div>
    `;

    container.innerHTML = htmlContent;
    document.body.appendChild(container);

    await new Promise(resolve => setTimeout(resolve, 200));

    try {
        const canvas = await html2canvas(container, {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            backgroundColor: '#ffffff'
        });

        const imgData = canvas.toDataURL('image/png');
        const pdf = new jsPDF('p', 'mm', 'a4');
        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = pageWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;

        let remainingHeight = imgHeight;
        let position = 0;
        let page = 1;

        while (remainingHeight > 0) {
            const sliceHeightMM = Math.min(remainingHeight, pageHeight);
            const srcY = position * (canvas.height / imgHeight);
            const srcHeightPX = sliceHeightMM * (canvas.height / imgHeight);

            const sliceCanvas = document.createElement('canvas');
            sliceCanvas.width = canvas.width;
            sliceCanvas.height = srcHeightPX;

            const ctx = sliceCanvas.getContext('2d');

            if (ctx) {
                ctx.drawImage(
                    canvas,
                    0, srcY, canvas.width, srcHeightPX,
                    0, 0, canvas.width, srcHeightPX
                );

                const sliceData = sliceCanvas.toDataURL('image/png');

                if (page > 1) {
                    pdf.addPage();
                }

                pdf.addImage(sliceData, 'PNG', 0, 0, imgWidth, sliceHeightMM);
            }

            remainingHeight -= sliceHeightMM;
            position += sliceHeightMM;
            page++;
        }

        pdf.save(`${championship.name}-lista-oficial.pdf`);

    } catch (error) {
        console.error('PDF Export Error:', error);
        alert('Erro ao gerar PDF');
    } finally {
        if (document.body.contains(container)) {
            document.body.removeChild(container);
        }
    }
};
