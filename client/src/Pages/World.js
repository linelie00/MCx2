import { Fragment } from 'react';
import '../Styles/World.css';
import world from '../Data/world';

// 본문 블록 타입별 렌더링. 클래스명/DOM 순서는 기존과 동일하게 유지한다.
const renderBlock = (block, i) => {
    switch (block.type) {
        case 'image':
            return (
                <img key={i} src={block.src} alt={block.alt} className={block.className} />
            );
        case 'label':
            return <p key={i} className="body-label">{block.text}</p>;
        case 'text':
            return (
                <span key={i} className="body-text">
                    {block.lines.map((line, j) => (
                        <Fragment key={j}>{line}<br /></Fragment>
                    ))}
                </span>
            );
        case 'figure':
            return (
                <div key={i} className="article-zetta-image">
                    <img src={block.src} alt={block.alt} />
                    <span className="body-text">{block.caption}</span>
                    <span className="body-comment">{block.comment}</span>
                </div>
            );
        default:
            return null;
    }
};

const World = () => {
    const { header, byline, body } = world;

    return (
        <div className="world-content">
            <div className="article">
                <div className="article-header">
                    <div className="header-box left-box">
                        {header.left.map((text, i) => (
                            <span className="header-label" key={i}>{text}</span>
                        ))}
                    </div>
                    <h2>{header.title}</h2>
                    <div className="header-box right-box">
                        <span className="header-label">{header.headline}</span>
                        <span className="header-details">{header.details}</span>
                    </div>
                </div>
                <div className="headline-divider">
                    {byline.map((text, i) => (
                        <span className="byname" key={i}>{text}</span>
                    ))}
                </div>
                <div className="article-body">
                    {body.map(renderBlock)}
                </div>
            </div>
        </div>
    );
};

export default World;
